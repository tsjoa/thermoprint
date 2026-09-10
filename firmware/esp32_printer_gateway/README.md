# ESP32-C3 BLE Thermal Printer Gateway (ESPHome)

This firmware turns an **ESP32-C3 Super Mini** (with 0.42" OLED) into a local, standalone network gateway for the **Marklife / Pristar P15** and **P12** Bluetooth thermal label printers.

---

## Features

- **No Cloud Dependencies**: Direct local BLE connection to the printer using ESPHome.
- **On-Demand Auto-Disconnect**: Automatically connects when a print job is received, prints, advances to the gap, and disconnects after 2 seconds of idle time. The printer remains free for phone apps and other users.
- **Optical Gap Indexing (`1D 0C`)**: Uses the printer's onboard optical gap sensor to index and advance labels cleanly without spanning gaps.
- **Calibrated Label Geometry**: 38.7mm ($310\text{ dots}$) width with automatic horizontal and vertical centering for standard 40×12mm label rolls.
- **Multiline Text Rendering**: Supports `\n` linebreaks with auto-layout for 1, 2, or 3 lines.
- **0.42" SSD1306 OLED (72×40)**: Displays gateway IP, P15 status (`STANDBY`, `PRINTING`, `READY`), TCP port `9100`, and live BLE RSSI.
- **Physical BOOT Button (GPIO9)**: Tap to trigger a test label; press to wake the display.
- **Raw TCP Server (Port 9100)**: Stream raw ESC/POS / L11 print jobs over local Wi-Fi from any machine.
- **Home Assistant / ESPHome Native API**: Exposes services `print_text(label_text, width_mm, feed_mm, density)`, `print_test_label()`, and `feed_gap()`.

---

## Hardware Pinout (ESP32-C3 Super Mini)

| Component | Pin / Address | Description |
|---|---|---|
| **OLED SDA** | `GPIO5` | I2C Data |
| **OLED SCL** | `GPIO6` | I2C Clock |
| **OLED I2C Address** | `0x3C` | SSD1306 72×40 display |
| **Physical Button** | `GPIO9` | Active-low with internal pullup |

---

## Flashing the Gateway

### 1. Configure Credentials
Create `secrets.yaml` inside `firmware/esp32_printer_gateway/`:
```yaml
wifi_ssid: "Your_WiFi_SSID"
wifi_password: "Your_WiFi_Password"
ap_password: "Fallback_AP_Password"
api_encryption_key: "your-base64-encryption-key="
ota_password: "your-ota-password"
```

### 2. Compile & Upload via USB
```bash
# Flash via connected USB-C serial port
uv run --with esphome esphome run firmware/esp32_printer_gateway/ble_thermal_printer_gateway.yaml --device /dev/ttyACM0
```

---

## Usage & API

### 1. Print Text via Python / Home Assistant API
```python
import asyncio
from aioesphomeapi import APIClient

async def print_label():
    client = APIClient(
        address="192.168.20.18",
        port=6053,
        password="",
        noise_psk="your-encryption-key="
    )
    await client.connect(login=True)
    _, services = await client.list_entities_services()
    
    for s in services:
        if s.name == "print_text":
            await client.execute_service(s, {
                "label_text": "Item: M1587\nLoc: Shelf A1",
                "width_mm": 38.7,
                "feed_mm": 5.0,
                "density": 3
            })
    await client.disconnect()

asyncio.run(print_label())
```

### 2. Stream Raw Bitmap over TCP (Port 9100)
```bash
# Stream raw print payload directly to gateway IP on port 9100
nc 192.168.20.18 9100 < print_job.bin
```
