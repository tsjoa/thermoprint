# Connecting & Printing to Marklife / Pristar P15 in Chrome on Linux

The **Pristar / Marklife P15** is a dual-mode Bluetooth device (supporting both Classic BR/EDR and Bluetooth Low Energy).

Due to how the Linux Bluetooth stack (**BlueZ**) handles dual-mode devices, Chrome's Native Web Bluetooth will attempt a Classic connection by default and fail with `br-connection-profile-unavailable`.

Here are the two proven methods to connect and print seamlessly on Linux.

---

## Method 1: The Native LE-Only Toggle (Recommended for Web Bluetooth)

Temporarily forcing your Bluetooth radio into strict Low Energy (LE) mode disables Classic BR/EDR profile negotiation, allowing Chrome Web Bluetooth to connect directly to the P15.

### Step 1: Switch Bluetooth to LE-Only Mode
Run the following in your terminal:
```bash
sudo btmgmt power off
sudo btmgmt bredr off
sudo btmgmt power on
```

### Step 2: Open Web Editor
1. Open the [thermoprint Web Editor](https://tomladder.github.io/thermoprint/) in Google Chrome or Microsoft Edge.
2. In the Printer Panel, ensure the connection mode is set to **BLE**.
3. Click **Print**. When Chrome displays the Bluetooth device picker dialog, select `P15_..._BLE`.
4. The printer will connect and print instantly.

### Step 3: Restoring Classic Bluetooth (Optional)
When you are done printing and need Classic Bluetooth audio/peripherals again:
```bash
sudo btmgmt power off
sudo btmgmt bredr on
sudo btmgmt power on
```

---

## Method 2: The Local HTTP Print Proxy (Bypasses BlueZ entirely)

If you do not want to disable Classic Bluetooth on your system, use the local proxy server which opens raw HCI LE sockets directly on the hardware:

### Step 1: Start the Local Proxy Server
```bash
# Reset Bluetooth adapter if needed
sudo hciconfig hci0 reset

# Start the print server with your printer's MAC address
thermoprint serve -a 03:0D:7A:D6:5E:B1
```

### Step 2: Print from the Web UI
1. Start the web UI locally (`cd packages/web && bun run dev`) and navigate to `http://localhost:5173`.
2. Select **Local** mode in the printer panel.
3. Click **Print** — jobs are sent to `POST http://localhost:7654/print` and streamed over raw BLE to the printer.

---

## Method 3: ESP32-C3 Wi-Fi BLE Gateway (No Linux Bluetooth Needed)

If you have an ESP32-C3 board, you can use the standalone ESPHome gateway in `firmware/esp32_printer_gateway/`:
- The ESP32 connects directly to the P15 over BLE and exposes a **Raw TCP port 9100** and **Home Assistant Native API**.
- Works from any machine on your local Wi-Fi without configuring Linux Bluetooth.
