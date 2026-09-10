#!/usr/bin/env python3
"""
Thermoprint USB Print Utility
Prints labels directly to Marklife / Pristar P12 / P15 and YC3121-based thermal printers via USB.
"""

import argparse
import sys
import time
from typing import Optional
from PIL import Image, ImageDraw, ImageFont

try:
    import usb.core
    import usb.util
    HAS_PYUSB = True
except ImportError:
    HAS_PYUSB = False

import newprint_withfeed

USB_VID = 0x09C7
USB_PID = 0x00D1


def find_usb_printer():
    """Finds the USB printer using PyUSB. Returns None if no printer is
    found, PyUSB isn't installed, or no USB backend (libusb) is available."""
    if not HAS_PYUSB:
        return None
    try:
        return usb.core.find(idVendor=USB_VID, idProduct=USB_PID)
    except usb.core.NoBackendError:
        return None


def send_usb_data(dev, data: bytes, chunk_size: int = 64, delay: float = 0.005) -> bool:
    """Sends raw bytes to USB Bulk OUT endpoint 0x01 with packet pacing."""
    try:
        if dev.is_kernel_driver_active(0):
            try:
                dev.detach_kernel_driver(0)
            except Exception:
                pass

        for i in range(0, len(data), chunk_size):
            chunk = data[i:i + chunk_size]
            dev.write(0x01, chunk, timeout=2000)
            if delay > 0:
                time.sleep(delay)
        return True
    except Exception as e:
        print(f"USB Transfer Error: {e}", file=sys.stderr)
        return False


def build_l11_payload(bitmap: Image.Image, feed_mm: float = 5.0, density: int = 3) -> bytes:
    """Encodes bitmap into the L11 column-major binary stream."""
    payload = newprint_withfeed.bitmap_to_packet(bitmap)
    canvas_width = bitmap.width
    feed_dots = max(0, min(255, round(feed_mm * 8)))

    packets = [
        bytes([0x1F, 0x70, 0x02, density]),  # Density command (1-5)
        bytes([0x10, 0xFF, 0x40]),            # Init
        bytes([
            *([0x00] * 15),
            0x10, 0xFF, 0xF1, 0x02,
            0x1D, 0x76, 0x30, 0x00,
            0x0C, 0x00,
            canvas_width & 0xFF, (canvas_width >> 8) & 0xFF
        ]),
        payload,
        bytes([0x1D, 0x0C]),                  # Position to Gap (1D 0C)
        bytes([0x10, 0xFF, 0xF1, 0x45])       # Stop / flush
    ]
    return b"".join(packets)


def build_escpos_payload(bitmap: Image.Image, feed_mm: float = 5.0) -> bytes:
    """Encodes bitmap into ESC/POS row-major raster stream."""
    # Ensure dimensions are aligned to 8 bits
    width, height = bitmap.size
    aligned_width = ((width + 7) // 8) * 8
    if aligned_width != width:
        padded = Image.new("1", (aligned_width, height), 1)
        padded.paste(bitmap, (0, 0))
        bitmap = padded
        width = aligned_width

    width_bytes = width // 8
    raster_data = bytearray()
    for y in range(height):
        for byte_idx in range(width_bytes):
            byte_val = 0
            for bit_idx in range(8):
                x = byte_idx * 8 + bit_idx
                if bitmap.getpixel((x, y)) == 0:
                    byte_val |= (0x80 >> bit_idx)
            raster_data.append(byte_val)

    feed_dots = max(0, min(255, round(feed_mm * 8)))

    job = bytearray()
    job.extend([0x1B, 0x40])  # ESC @
    job.extend([
        0x1D, 0x76, 0x30, 0x00,
        width_bytes & 0xFF, (width_bytes >> 8) & 0xFF,
        height & 0xFF, (height >> 8) & 0xFF
    ])
    job.extend(raster_data)
    job.extend([0x1B, 0x4A, feed_dots])  # Feed
    return bytes(job)


def print_usb_label(
    text: str,
    qr: Optional[str] = None,
    protocol: str = "l11",
    width_mm: float = 40.0,
    height_mm: float = 12.0,
    feed_mm: float = 5.0,
    density: int = 3,
    border: bool = False,
    font_scale: float = 1.0,
) -> bool:
    dev = find_usb_printer()
    if dev is None:
        print(f"Error: Could not find USB printer ({USB_VID:04x}:{USB_PID:04x}).", file=sys.stderr)
        print("Ensure the printer is connected and powered on.", file=sys.stderr)
        return False

    print(f"Found USB printer: ID {dev.idVendor:04x}:{dev.idProduct:04x} ({dev.manufacturer} {dev.product})")

    # Generate label image
    img = newprint_withfeed.construct_bitmap(
        text=text,
        width_mm=width_mm,
        height_mm=height_mm,
        show_qr=bool(qr),
        qr_content=qr,
        border=border,
        font_scale=font_scale,
    )

    if protocol.lower() == "escpos":
        data = build_escpos_payload(img, feed_mm=feed_mm)
    else:
        data = build_l11_payload(img, feed_mm=feed_mm, density=density)

    print(f"Sending {len(data)} bytes over USB using '{protocol.upper()}' protocol...")
    success = send_usb_data(dev, data)
    usb.util.dispose_resources(dev)

    if success:
        print("Print job sent successfully over USB!")
    return success


def main():
    parser = argparse.ArgumentParser(description="Print labels via USB to Marklife/Pristar P12/P15 printers.")
    parser.add_argument("text", help="Text to print on the label (supports \\n for multiple lines)")
    parser.add_argument("--qr", "-q", help="Optional QR code content")
    parser.add_argument("--protocol", "-p", choices=["l11", "escpos"], default="l11", help="Protocol mode (default: l11)")
    parser.add_argument("--width", "-w", type=float, default=40.0, help="Label width in mm (default: 40.0)")
    parser.add_argument("--height", "-H", type=float, default=12.0, help="Label height in mm (default: 12.0)")
    parser.add_argument("--feed", "-f", type=float, default=5.0, help="Feed paper advance in mm (default: 5.0)")
    parser.add_argument("--density", "-d", type=int, default=3, choices=[1, 2, 3, 4, 5], help="Print density (default: 3)")
    parser.add_argument("--border", "-b", action="store_true", help="Draw a border around the label")
    parser.add_argument("--scale", "-s", type=float, default=1.0, help="Font scale factor (default: 1.0)")

    args = parser.parse_args()
    success = print_usb_label(
        text=args.text,
        qr=args.qr,
        protocol=args.protocol,
        width_mm=args.width,
        height_mm=args.height,
        feed_mm=args.feed,
        density=args.density,
        border=args.border,
        font_scale=args.scale,
    )
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
