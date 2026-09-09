# P15 BLE Thermal Printer - Technical Notes

## Working Print Path

Printing to the P15 (MAC `03:0D:7A:D6:5E:B1`) requires bypassing BlueZ entirely
and using `bluepy-helper` for raw HCI LE connections. The reference implementation
is `newprint_withfeed.py`.

### The Dual-Mode BlueZ Bug (br-connection-profile-unavailable)

The P15 is a **dual-mode** Bluetooth device that supports both BR/EDR (Classic) and LE (Low Energy). 
However, its Classic Bluetooth implementation expects a specific endpoint (like a Serial Port Profile). When Native Web Bluetooth (Chrome) or Python's `bleak` attempts to connect, BlueZ unconditionally prioritizes Classic BR/EDR connections for dual-mode devices. Because your Linux system doesn't have an active SPP profile agent by default, BlueZ aborts the entire connection instantly with `br-connection-profile-unavailable` before ever attempting Low Energy.

Because of this built-in OS mechanism, Chrome Web Bluetooth will perpetually fail unless you force BlueZ into LE mode, or bypass BlueZ entirely.

We have two working paths to bypass this:
1. **The Native LE-Mode Bypass**: Dynamically power down the Bluetooth adapter and turn off its Classic Bluetooth capabilities so BlueZ is forced to operate in strict LE mode. Chrome will then successfully connect natively via LE.
2. **The bluepy-helper Proxy**: Use a local node proxy server wrapping `bluepy-helper` which opens raw HCI LE sockets directly on the hardware, sidestepping BlueZ's profile manager entirely.

### bluepy-helper

The `bluepy-helper` binary (from Python's `bluepy` package) is a C program that
talks directly to the HCI socket, bypassing BlueZ's profile system entirely.

- **Location**: `.venv/lib/python3.12/site-packages/bluepy/bluepy-helper`
- **Find dynamically**: `uv run python3 -c "import bluepy, os; print(os.path.join(os.path.dirname(bluepy.__file__), 'bluepy-helper'))"`
- **Protocol**: line-based text over stdin/stdout, fields separated by `\x1e` (record separator)

### Connection sequence

1. Spawn `bluepy-helper` with stdin/stdout pipes
2. Send `conn <address> public\n`
3. Wait for `rsp=stat state=conn` (may see `state=tryconn` first)
4. **Set MTU**: Send `mtu 64\n` (100 decimal) and wait for `stat` response
   - **Critical**: Without this, BLE default MTU is 23 bytes and 96-byte writes are silently truncated
5. Discover characteristics: Send `char 1 FFFF\n`, wait for `find` response

### P15 BLE characteristics

| UUID   | Decl Handle | Value Handle | Purpose                    |
|--------|-------------|--------------|----------------------------|
| ff01   | 0x0D        | 0x0E         | RX (notify) - printer status |
| ff02   | 0x10        | 0x11         | TX (write) - send data      |
| ff03   | 0x12        | 0x13         | CX (notify) - flow control  |

Service UUID: `0000ff00-0000-1000-8000-00805f9b34fb`

### Bitmap format (column-major)

The P15 uses a **column-major** bitmap format, NOT standard ESC/POS row-major raster.

**Header**: `1D 76 30 00 <bytesPerCol_lo> <bytesPerCol_hi> <width_lo> <width_hi>`

- `bytesPerCol` = `ceil(height / 8)` (e.g., 12 for 96px tall)
- `width` = image width in pixels

**Data encoding** (from `newprint_withfeed.py` `bitmap_to_packet`):

```
for each column x (left to right):
    for each 8-row group from BOTTOM to TOP:
        pack 8 vertical pixels into one byte
        bit 0 = topmost pixel of group, bit 7 = bottommost
        set bit = black pixel
```

In code:
```python
for x in range(width):
    for y_byte_group in range(height - 8, -1, -8):  # bottom to top
        byte = 0
        for bit in range(8):
            px_y = y_byte_group + bit
            if pixel_is_black(x, px_y):
                byte |= (1 << bit)
```

### Image orientation

The column-major encoding effectively rotates the image during printing. This means:

- **CLI / proxy server**: Send the image **unrotated** (as designed in the label editor).
  The column-major encoding handles orientation.
- **Web Bluetooth (BLE mode)**: The existing row-major path rotates 90° CW before sending.
  This was designed for standard ESC/POS raster printers.

The web UI's `useCanvasExport` hook checks `connectionMode` and only rotates in BLE mode.

### Image size

The printer works best with compact images. The Python reference sends ~170×96 pixels
for a line of text. The web UI's label editor produces larger images (e.g., 320×96 for
a 40×12mm label).

Large images or overlong text content will either print incorrectly or fail to print — the printer
has a limited receive buffer.

### Line Length & Character Limits (40×12mm Labels)

- **Max Characters Per Line**: At default 22px font size on a 40×12mm label (with QR code), a single line can contain up to **16 characters** (e.g. `123456789_123456`).
- **Overlong Line Failure Mode**: If a text line exceeds the bounding box (17+ characters), the printer drops the BLE connection mid-stream. This results in a `bluepy-helper exited` error, and the label does not print. A subsequent command will re-establish the connection.

### Print packet sequence

All writes go to handle 0x11 (ff02 TX), without response (`wr` not `wrr`),
in 96-byte chunks with 30ms delay between chunks.

1. **Status query**: `10 FF 40`
2. **Wakeup + Enable + Bitmap header**: 15 zero bytes + `10 FF F1 02` + `1D 76 30 00 <bytesPerCol> <width>` (27 bytes total)
3. **Bitmap payload**: column-major encoded data
4. **Line feeds**: `0A 0A 0A 0A 0A` (5 line feeds to advance paper)
5. **Gap paper**: `1D 0C` (position to gap) + `10 FF F1 45` (stop)
6. **Continuous paper**: `10 FF F1 45` (stop only)

### Chunk size and timing

- **Chunk size**: 96 bytes (matches Python)
- **Inter-chunk delay**: 30ms
- **No flow control**: The raw bluepy path does NOT use credit-based flow control via CX characteristic. Simple timed pacing is sufficient.

### BLE adapter reset

If bluepy-helper fails to connect (timeout), reset the BT adapter first:
```bash
sudo hciconfig hci0 reset
```
This clears any stale BlueZ state that may interfere with raw HCI connections.

---

## Usage

There are distinct ways to use the printer depending on if you want a seamless browser experience (Native Web Bluetooth) or want to bypass OS-level bugs via a local proxy script.

### 1. Chrome Native Web Bluetooth (LE-Only Toggle)

If you want to print directly from Chrome without running a local proxy, you must force your Bluetooth radio into strict Low Energy (LE) mode. This eliminates the `br-connection-profile-unavailable` bug completely.

**Step 1:** Force your Bluetooth adapter into LE-only mode:
```bash
sudo btmgmt power off
sudo btmgmt bredr off
sudo btmgmt power on
```
*(Note: As long as BR/EDR is turned off, standard Classic Bluetooth devices like audio headphones or wireless mice won't connect. You can restore default behavior at any time using `sudo btmgmt power off && sudo btmgmt bredr on && sudo btmgmt power on`).*

**Step 2:** Start the web UI:
```bash
cd packages/web && bun run dev
```

**Step 3:** Open the web UI (default http://localhost:5173). Set the printer panel to "**BLE**" mode. Click Print, and when Chrome prompts you, select the P15 printer. It will instantly connect and print!

---

### 2. Web UI with local print server (Proxy Mode)

If you don't want to disable Classic Bluetooth on your system, you can use the proxy server. The web UI sends images to a local HTTP server which handles the BLE connection via `bluepy-helper`, completely bypassing BlueZ.

**Step 1**: Start the print server in one terminal:
```bash
sudo hciconfig hci0 reset    # may be needed if BT adapter is in a bad state
thermoprint serve -a 03:0D:7A:D6:5E:B1
```

**Step 2**: Start the web UI in another terminal:
```bash
cd packages/web && bun run dev
```

**Step 3**: Open the web UI (default http://localhost:5173). The printer panel should
show "Local" mode selected and auto-connect to the print server. Design your label
and click Print.
The print server accepts print jobs on `POST http://localhost:7654/print` and handles
trimming, dithering, column-major encoding, and BLE transmission.

---

### 3. Standalone ESP32-C3 Wi-Fi BLE Gateway (ESPHome)

For a completely cloud-free, serverless setup that works across your local network without any Linux Bluetooth configuration:

1. Flash the ESPHome firmware in `firmware/esp32_printer_gateway/`.
2. The ESP32-C3 automatically connects to the P15 on demand when a print job arrives, prints with calibrated 38.7mm width and optical gap advance (`1D 0C`), and disconnects 2 seconds after finishing so phone apps can still connect.
3. Send print jobs via:
   - **Raw TCP port 9100** (`nc <gateway_ip> 9100 < print_stream.bin`)
   - **ESPHome / Home Assistant API** (`print_text`, `print_test_label`, `feed_gap`)
   - **Physical Button on GPIO9**

*(See [firmware/esp32_printer_gateway/README.md](firmware/esp32_printer_gateway/README.md) for full details).*

---

### CLI with template file

```bash
# Reset BT adapter if needed
sudo hciconfig hci0 reset

# Print a JSON template
thermoprint print-template -a 03:0D:7A:D6:5E:B1 template.json

# Dry run — render and save image without printing
thermoprint print-template --dry-run --save-image preview.png template.json
```

Template format:
```json
{
  "label": { "widthMm": 40, "heightMm": 12 },
  "elements": [
    {
      "type": "text",
      "x": 4, "y": 4,
      "width": 200, "height": 40,
      "text": "Hello",
      "fontSize": 48,
      "fontFamily": "sans-serif"
    }
  ]
}
```

### Minimal test script

For quick testing without the full template pipeline:
```bash
cd packages/cli
sudo hciconfig hci0 reset
bun test-print.ts "Hello World"
```

---

## Implementation files

| File | Purpose |
|------|---------|
| `packages/cli/src/transport/bluepy.ts` | BluepyBleTransport wrapping bluepy-helper binary |
| `packages/cli/src/cli/commands/serve.ts` | HTTP print proxy server (`thermoprint serve`) |
| `packages/cli/src/cli/commands/print-template.ts` | CLI print-template command with `-a` flag |
| `packages/cli/test-print.ts` | Minimal test script replicating newprint_withfeed.py |
| `packages/core/src/protocol/l11/commands.ts` | `printBitmap()` with column-major encoding |
| `packages/core/src/protocol/l11/protocol.ts` | `buildPrintSequence()` with status query + line feeds |
| `packages/web/src/transport/proxy.ts` | Web UI proxy client (fetch to localhost:7654) |
| `packages/web/src/hooks/use-canvas-export.ts` | Canvas export — skips rotation in proxy mode |
| `packages/web/src/hooks/use-printer.ts` | Print hook — routes to proxy or Web Bluetooth |
| `packages/web/src/printer/printer-panel.tsx` | Printer panel with Local/BLE mode toggle |
| `packages/web/src/store/printer-store.ts` | Zustand store with `connectionMode` state |
