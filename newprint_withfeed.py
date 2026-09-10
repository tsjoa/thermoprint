#!/usr/bin/env python3
try:
    from bluepy.btle import Peripheral, BTLEDisconnectError
except ImportError:
    Peripheral = None
    BTLEDisconnectError = Exception
from PIL import Image, ImageDraw, ImageFont
from matplotlib import font_manager
import argparse
import time
import sys

SERVICE_UUID = "0000ff00-0000-1000-8000-00805f9b34fb"
CHAR_UUID = "0000ff02-0000-1000-8000-00805f9b34fb"

import qrcode


def _load_font(font_family, bold, italic, font_size):
    """Loads a TrueType font, falling back to Arial or PIL's built-in default."""
    try:
        font_path = font_manager.findfont(font_manager.FontProperties(
            family=font_family,
            weight="bold" if bold else "normal",
            style="italic" if italic else "normal"
        ))
        return ImageFont.truetype(font_path, font_size)
    except Exception:
        try:
            return ImageFont.truetype(f"{font_family}.ttf", font_size)
        except IOError:
            try:
                return ImageFont.truetype("arial.ttf", font_size)
            except IOError:
                return ImageFont.load_default()


def _fit_font_size(lines, font_family, bold, italic, avail_width, avail_height, min_size=8, max_size=64):
    """Finds the largest font size whose rendered text fits within avail_width/avail_height."""
    best = min_size
    for size in range(max_size, min_size - 1, -1):
        font = _load_font(font_family, bold, italic, size)
        line_height = int(size * 1.15)
        if line_height * len(lines) > avail_height:
            continue
        max_line_width = max(
            (font.getbbox(line)[2] - font.getbbox(line)[0]) for line in lines
        )
        if max_line_width <= avail_width:
            best = size
            break
    return best


def construct_bitmap(
    text,
    font_size=None,
    font_family="Arial",
    bold=False,
    italic=False,
    underline=False,
    canvas_height=96,
    width_mm=40.0,
    height_mm=12.0,
    show_qr=True,
    qr_content=None,
    border=False,
    font_scale=1.0,
    min_font_size=8,
    max_font_size=64,
):
    """Creates a monochrome bitmap label from text and optional QR code.

    If font_size is omitted, the largest font that fits the available text
    area is chosen automatically (so short text, e.g. <=10 chars, prints much
    larger than a long multi-line label would). font_scale then multiplies
    that chosen (or explicit) size, letting callers bump everything up or
    down without fighting the auto-fit logic.
    """
    width_px = int(width_mm * 8)    # 320 px for 40mm
    height_px = int(canvas_height)  # 96 px for 12mm

    formatted_text = text.replace('\\n', '\n')
    lines = [line.strip() for line in formatted_text.split('\n') if line.strip()] or [text]

    text_x = 12
    if show_qr:
        qr_size = int(height_px * 0.875)  # 84px for 96px canvas
        qr_x = width_px - qr_size - 16    # 220px for 320px width
        avail_width = qr_x - text_x - 6
    else:
        avail_width = width_px - text_x - 12
    avail_height = height_px - 4

    if font_size is None or font_size <= 0:
        font_size = _fit_font_size(
            lines, font_family, bold, italic,
            avail_width=avail_width, avail_height=avail_height,
            min_size=min_font_size, max_size=max_font_size,
        )

    if font_scale and font_scale != 1.0:
        font_size = max(min_font_size, min(max_font_size, round(font_size * font_scale)))

    font = _load_font(font_family, bold, italic, font_size)

    img = Image.new('1', (width_px, height_px), color=1)
    draw = ImageDraw.Draw(img)

    if show_qr:
        qr_y = (height_px - qr_size) // 2

        qr_text = qr_content if qr_content else formatted_text.replace('\n', ' ')
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=2,
            border=1,
        )
        qr.add_data(qr_text)
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color="black", back_color="white").convert('1')
        qr_img = qr_img.resize((qr_size, qr_size), Image.Resampling.NEAREST)
        img.paste(qr_img, (qr_x, qr_y))

    line_height = int(font_size * 1.15)
    total_text_height = len(lines) * line_height
    start_y = max(2, (height_px - total_text_height) // 2)

    for i, line in enumerate(lines):
        y_pos = start_y + (i * line_height)
        draw.text((text_x, y_pos), line, font=font, fill=0)

    if border:
        draw.rectangle([(2, 2), (width_px - 3, height_px - 3)], outline=0, width=1)

    return img

def bitmap_to_packet(bitmap):
    """Converts a PIL image to the printer's packet format."""
    width, height = bitmap.size
    bytes_ = []
    for x in range(width):
        for y_byte_group in range(height - 8, -1, -8):
            byte = 0
            for bit in range(8):
                px_y = y_byte_group + bit
                if 0 <= px_y < height and bitmap.getpixel((x, px_y)) == 0:
                    byte |= (1 << bit)
            bytes_.append(byte)
    return bytes(bytes_)

def connect_to_printer(device_address, retries=5, delay=2):
    """Connects to the printer via BLE (bluepy)."""
    if Peripheral is None:
        print("bluepy is not installed or not supported on this platform (Linux only).")
        return None
    for i in range(retries):
        try:
            print(f"Connecting to {device_address} (attempt {i+1}/{retries})...")
            peripheral = Peripheral(device_address)
            peripheral.setMTU(100)
            print(f"Connected to {device_address}")
            return peripheral
        except BTLEDisconnectError as e:
            print(f"Connection attempt {i+1}/{retries} failed: {e}")
            if i < retries - 1:
                time.sleep(delay)
            else:
                print("Could not connect. Make sure the printer is in BLE mode (blue light).")
                return None
        except Exception as e:
            print(f"Unexpected error: {e}")
            time.sleep(delay)
    return None


def send_print_job(peripheral, bitmap, segmented_paper=False, feed_mm=5.0):
    """Sends the print job to a connected printer with proper paper advance.

    feed_mm controls the blank paper fed out after the label, using the
    L11 protocol's dot-precise "ESC J" feed command (`1B 4A NN`).
    """
    payload = bitmap_to_packet(bitmap)
    canvas_width = bitmap.width
    feed_dots = max(0, min(255, round(feed_mm * 8)))  # 8 dots/mm (203 dpi print head)

    try:
        char = peripheral.getCharacteristics(uuid=CHAR_UUID)[0]

        # Build packets
        packets = [
            bytes([0x10, 0xff, 0x40]),  # init command
            bytes([
                *([0x00] * 15),
                0x10, 0xff, 0xf1, 0x02, 0x1d,
                0x76,
                0x30, 0x00,
                0x0c, 0x00,
                canvas_width & 0xff, (canvas_width >> 8) & 0xff
            ]),
            payload,
        ]

        if segmented_paper:
            packets.extend([
                bytes([0x1D, 0x0C]),
                bytes([0x10, 0xFF, 0xF1, 0x45]),
            ])
        else:
            packets.extend([
                bytes([0x1B, 0x4A, feed_dots]),
                bytes([0x10, 0xFF, 0xF1, 0x45]),
            ])

        # Send packets in chunks
        for p in packets:
            chunks = [p[i:i + 96] for i in range(0, len(p), 96)]
            for chunk in chunks:
                char.write(chunk, withResponse=False)
                time.sleep(0.03)

        print("Print successful!")
        return True
    except Exception as e:
        print(f"Print error: {e}")
        return False



def main():
    parser = argparse.ArgumentParser(description="Interactive BLE thermal printer using bluepy.")
    parser.add_argument("--font-size", type=int, default=72)
    parser.add_argument("--font-family", type=str, default="Arial")
    parser.add_argument("--bold", action="store_true")
    parser.add_argument("--italic", action="store_true")
    parser.add_argument("--underline", action="store_true")
    parser.add_argument("--segmented-paper", action="store_true")
    parser.add_argument("--save-image", type=str, default=None, metavar="PATH", help="Save bitmap as PNG and exit (no print)")
    args = parser.parse_args()

    if args.save_image:
        text = input("Enter text: ")
        bitmap = construct_bitmap(text, args.font_size, args.font_family, args.bold, args.italic, args.underline)
        bitmap.convert("RGB").save(args.save_image)
        print(f"Saved {bitmap.size[0]}x{bitmap.size[1]} image to {args.save_image}")
        sys.exit(0)

    device_address = "03:0D:7A:D6:5E:B1"

    peripheral = connect_to_printer(device_address)
    if peripheral is None:
        sys.exit(1)

    print("\nPrinter ready. Enter text to print (Ctrl+C to exit).")
    try:
        while True:
            text_to_print = input("Enter text: ")
            if peripheral is None:
                print("Printer disconnected. Attempting to reconnect...")
                peripheral = connect_to_printer(device_address)
                if peripheral is None:
                    print("Reconnection failed. Exiting.")
                    break
            bitmap = construct_bitmap(
                text_to_print,
                args.font_size,
                args.font_family,
                args.bold,
                args.italic,
                args.underline
            )
            try:
                send_print_job(peripheral, bitmap, args.segmented_paper)
            except BTLEDisconnectError:
                print("Printer disconnected unexpectedly.")
                peripheral = None

    except KeyboardInterrupt:
        print("\nDisconnecting from printer...")
    finally:
        try:
            peripheral.disconnect()
        except Exception:
            pass
        print("Disconnected.")

if __name__ == "__main__":
    main()