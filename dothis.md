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

## 4. Calibrating a New Roll (Millimeter Calibration Ruler)

Whenever you insert a new label roll (e.g. 30mm, 40mm, 50mm, or unknown size), print the millimeter ruler:

```bash
uv run --with aioesphomeapi python3 -c '
import asyncio
from aioesphomeapi import APIClient

async def ruler():
    client = APIClient(address="192.168.20.18", port=6053, password="", noise_psk="iY3Kssct4ASmO9MGWVY0L32HnwUXjO6ujW8ETa8vbc8=")
    await client.connect(login=True)
    _, services = await client.list_entities_services()
    svc = next(s for s in services if s.name == "print_calibration_ruler")
    await client.execute_service(svc, {"max_mm": 50.0})
    await asyncio.sleep(2)
    await client.disconnect()

asyncio.run(ruler())
'
```

* **How to read the ruler**: Look at the number right at the trailing gap edge of the label.
* **Formula**:
  $$\text{Calibrated Width} = \text{Physical Number on Ruler} - 3.3\text{ mm (safe margins)}$$
  *(For our 42mm roll: $42.0\text{ mm} - 3.3\text{ mm} = \mathbf{38.7\text{ mm}}$).*

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
