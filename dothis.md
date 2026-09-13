# Thermoprint & ESP32-C3 BLE Gateway — User Guide

This guide explains how to use all the tools and features developed for the **Pristar / Marklife P15** thermal label printer via the **ESP32-C3 BLE Gateway**.

---

## 🚀 Gateway Overview & Status

* **Gateway IP**: `192.168.20.18` (over local Wi-Fi)
* **P15 Printer Bluetooth MAC**: `03:0D:7A:D6:5E:B1`
* **On-Demand Auto-Disconnect**: The gateway stays in `STANDBY` when idle. When you send a print job, it connects, prints, advances to the optical gap (`1D 0C`), and disconnects 2 seconds later so phones (Marklife app) and other users can connect.
* **0.42" OLED Display**: Displays Gateway IP, P15 status (`STANDBY`, `PRINTING`, `READY`), Port `9100`, and live BLE RSSI.
* **Physical BOOT Button (GPIO9)**: Tap to trigger a test print; press to wake the display.

---

## 1. Quick Printing via Python / Home Assistant API (Port 6053)

You can send print commands directly from any machine on your network using `aioesphomeapi`:

### A. Print Text (Auto-Scaling 1–3 Lines)
The gateway automatically scales font size and centers text horizontally and vertically for 1, 2, or 3 lines:

```bash
uv run --with aioesphomeapi python3 -c '
import asyncio
from aioesphomeapi import APIClient

async def print_label(text):
    client = APIClient(
        address="192.168.20.18",
        port=6053,
        password="",
        noise_psk="iY3Kssct4ASmO9MGWVY0L32HnwUXjO6ujW8ETa8vbc8="
    )
    await client.connect(login=True)
    _, services = await client.list_entities_services()
    svc = next(s for s in services if s.name == "print_text")
    await client.execute_service(svc, {
        "label_text": text,
        "width_mm": 38.7,    # Calibrated width for 42x12mm rolls
        "feed_mm": 5.0,
        "density": 3         # 1=light, 3=normal/dark, 5=max
    })
    await asyncio.sleep(2)
    await client.disconnect()

asyncio.run(print_label("STORAGE\nSHELF B4\nBOX 12"))
'
```

---

## 2. Printing QR Codes + Multiline Text (Side-by-Side)

To print a label with a scannable QR code on the left and 3 lines of text on the right:

```bash
uv run python3 -c "
import socket, qrcode
from PIL import Image, ImageDraw, ImageFont

WIDTH = 310  # 38.7mm @ 203 DPI
HEIGHT = 96  # 12mm
img = Image.new('1', (WIDTH, HEIGHT), color=1)
draw = ImageDraw.Draw(img)

# Border
draw.rectangle([(2, 2), (WIDTH - 3, HEIGHT - 3)], outline=0, width=1)

# QR Code on Left
qr = qrcode.QRCode(box_size=3, border=1)
qr.add_data('ITEM-98765')
qr_img = qr.make_image(fill_color='black', back_color='white').convert('1').resize((74, 74), Image.Resampling.NEAREST)
img.paste(qr_img, (12, 11))

# Text on Right
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 16)
except Exception:
    font = ImageFont.load_default()

lines = ['tp 1234', 'hll', 'ooo!']
for line, y in zip(lines, [14, 40, 66]):
    draw.text((98, y), line, fill=0, font=font)

# Convert to column-major binary packet
bytes_ = []
for x in range(WIDTH):
    for y_group in range(HEIGHT - 8, -1, -8):
        byte = 0
        for bit in range(8):
            py = y_group + bit
            if 0 <= py < HEIGHT and img.getpixel((x, py)) == 0:
                byte |= (1 << bit)
        bytes_.append(byte)

packets = bytearray([0x1F, 0x70, 0x02, 0x03, 0x10, 0xFF, 0x40] + [0x00]*15 + [0x10, 0xFF, 0xF1, 0x02, 0x1D, 0x76, 0x30, 0x00, 0x0C, 0x00, WIDTH & 0xFF, (WIDTH >> 8) & 0xFF] + bytes_ + [0x1D, 0x0C, 0x10, 0xFF, 0xF1, 0x45])

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    s.connect(('192.168.20.18', 9100))
    s.sendall(packets)
"
```

---

## 3. Batch Printing (Sequenced Numbers / Iterations)

To batch print multiple numbered labels in a row without drift:

```bash
uv run --with aioesphomeapi python3 -c '
import asyncio
from aioesphomeapi import APIClient

async def batch():
    client = APIClient(address="192.168.20.18", port=6053, password="", noise_psk="iY3Kssct4ASmO9MGWVY0L32HnwUXjO6ujW8ETa8vbc8=")
    await client.connect(login=True)
    _, services = await client.list_entities_services()
    svc = next(s for s in services if s.name == "print_text")
    
    for i in range(1, 21):
        print(f"Printing label {i}/20...")
        await client.execute_service(svc, {
            "label_text": f"Hello &*{i}!",
            "width_mm": 38.7,
            "feed_mm": 5.0,
            "density": 3
        })
        await asyncio.sleep(2.5)
        
    await client.disconnect()

asyncio.run(batch())
'
```

---

## 4. Deterministic Roll Calibration (10cm Millimeter Ruler)

Whenever you insert a new label roll (e.g. 30mm, 40mm, 50mm, or unknown size), run the interactive calibration tool:

```bash
# Run interactive 10cm ruler calibration
uv run thermoprint calibrate

# Or check currently saved calibration
uv run thermoprint calibrate --show

# Or manually override roll length in mm
uv run thermoprint calibrate --set-mm 42.0
```

### Calibration Workflow:
1. The gateway prints a continuous **10cm (100mm)** millimeter ruler and advances to the gap sensor stop.
2. Inspect **Label #1** and note the millimeter number right at the trailing gap/cut line (e.g. `42`).
3. Type `42` into the prompt.
4. The tool automatically computes the exact printable width with safe 1.65mm border margins:
   $$\text{Printable Width} = \text{Observed Length (42mm)} - 3.3\text{ mm} = \mathbf{38.7\text{ mm}}$$
   and saves the configuration to `calibration.json`.
5. Optionally prints a confirmation label to verify perfect edge-to-edge alignment.
---

## 5. Raw Network Printing (TCP Port 9100)

Stream any raw ESC/POS or L11 binary bitmap directly to the printer over Wi-Fi:

```bash
# Using Netcat
nc 192.168.20.18 9100 < print_payload.bin

# Using thermoprint CLI
uv run thermoprint label "Hallway" --gateway 192.168.20.18:9100 --width-mm 38.7 --no-qr
```

---

## 6. Manual Gap Feed & Test Label

You can advance the paper to the next gap or trigger a test label without typing text:

* **Trigger Test Label**:
  ```bash
  uv run --with aioesphomeapi python3 -c 'import asyncio; from aioesphomeapi import APIClient; c=APIClient(address="192.168.20.18", port=6053, password="", noise_psk="iY3Kssct4ASmO9MGWVY0L32HnwUXjO6ujW8ETa8vbc8="); asyncio.run(c.connect(login=True)); asyncio.run(c.execute_service(next(s for s in c.list_entities_services()[1] if s.name=="print_test_label"), {})); asyncio.run(c.disconnect())'
  ```
* **Advance to Next Gap**:
  ```bash
  uv run --with aioesphomeapi python3 -c 'import asyncio; from aioesphomeapi import APIClient; c=APIClient(address="192.168.20.18", port=6053, password="", noise_psk="iY3Kssct4ASmO9MGWVY0L32HnwUXjO6ujW8ETa8vbc8="); asyncio.run(c.connect(login=True)); asyncio.run(c.execute_service(next(s for s in c.list_entities_services()[1] if s.name=="feed_gap"), {})); asyncio.run(c.disconnect())'
  ```
* **Physical Hardware**: Tap the **BOOT button (GPIO9)** on the ESP32-C3 board to trigger a test label.

---

## 7. Direct USB Printing (Pristar / Marklife P12)

The **P12** features a native USB Printer Class interface (`09c7:0011`, `/dev/usb/lp*`) and can be steered directly via USB:

### A. Query Printer Information & Battery
```bash
uv run python3 usb_print.py --info
```
*Outputs model (P12), firmware version (V2.05K), battery percentage, and ready status.*

### B. Print Text Label via CLI
```bash
uv run python3 cli.py label --usb "Storage Box 4" --no-qr
```

### C. Print with USB Print Utility
```bash
# Continuous roll (safe feed):
uv run python3 usb_print.py "Part #A123" --paper continuous --feed 5.0

# Die-cut gap labels:
uv run python3 usb_print.py "Part #A123" --paper gap
```

---

## 8. Home Assistant Dashboard Card & Dynamic Gateway Services

A custom Lovelace card (`custom:label-printer-card`) is installed on your Home Assistant instance at:
👉 **`http://192.168.20.226:8123/lovelace/labels`**

### Features:
* **Live WYSIWYG Canvas Preview**: Real-time rendering showing exact label dimensions, aspect ratio, text layout, and QR code placement.
* **Dynamic Printer Selection**: Switch between **P12 (`5E:55:09:26:72:D3`)** and **P15 (`03:0D:7A:D6:5E:B1`)** on the fly without re-flashing.
* **WYSIWYG Bitmap Streaming (`print_bitmap`)**: Transmits the rendered canvas pixels directly to the thermal printhead for smooth vector typography, precise border toggles, and sharp QR codes.
* **Paper Modes**: Supports both **Die-Cut Gap** (`1D 0C`) and **Continuous Roll** (`1B 4A <dots>`).

### Gateway API Services Exposed in Home Assistant:
| Service | Parameters | Description |
| :--- | :--- | :--- |
| `esphome.ble_printer_gateway_print_bitmap` | `bitmap_data` (b64), `canvas_width`, `feed_mm`, `density`, `paper_type`, `printer_mac` | Streams exact 1-bit canvas pixels to the printer |
| `esphome.ble_printer_gateway_print_text` | `label_text`, `width_mm`, `feed_mm`, `density`, `border`, `paper_type`, `printer_mac` | Prints text directly via firmware font |
| `esphome.ble_printer_gateway_set_target_printer`| `mac_address` | Dynamically updates the BLE client's target MAC address |
| `esphome.ble_printer_gateway_feed_gap` | *(none)* | Advances paper to the next optical gap notch |
| `esphome.ble_printer_gateway_print_test_label` | *(none)* | Prints a gateway diagnostic test label |
