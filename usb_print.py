#!/usr/bin/env python3
"""
Thermoprint USB Print Utility
Prints labels directly to Marklife / Pristar P12 / P15 and YC3121-based thermal printers via USB.
Supports both Linux kernel usblp (/dev/usb/lp*) devices and PyUSB (raw bulk transfers).
"""

import argparse
import glob
import os
import select
import sys
import time
from typing import Dict, Optional, Tuple, Union
from PIL import Image, ImageDraw, ImageFont

try:
    import usb.core
    import usb.util
    HAS_PYUSB = True
except ImportError:
    HAS_PYUSB = False

import newprint_withfeed

# Known vendor and product IDs
SUPPORTED_DEVICES = [
    (0x09C7, 0x0011, "Marklife / Pristar P12 (YXWL)"),
    (0x09C7, 0x00D1, "Marklife / Pristar P15"),
]
KNOWN_VENDOR_IDS = [0x09C7]


class USBPrinterDevice:
    """Unified wrapper around PyUSB device or /dev/usb/lp* character device."""

    def __init__(
        self,
        pyusb_dev=None,
        lp_path: Optional[str] = None,
        id_vendor: int = 0x09C7,
        id_product: int = 0x0011,
        manufacturer: str = "YXWL",
        product: str = "P12",
    ):
        self.pyusb_dev = pyusb_dev
        self.lp_path = lp_path
        self.idVendor = id_vendor
        self.idProduct = id_product
        self.manufacturer = manufacturer
        self.product = product

    @property
    def is_p12(self) -> bool:
        return self.idProduct == 0x0011 or "p12" in self.product.lower()

    @property
    def is_p15(self) -> bool:
        return self.idProduct == 0x00D1 or "p15" in self.product.lower() or "yc3121" in self.product.lower()
    def __repr__(self):
        source = self.lp_path if self.lp_path else "PyUSB"
        return f"<USBPrinter {self.idVendor:04x}:{self.idProduct:04x} ({self.manufacturer} {self.product}) via {source}>"

    def close(self):
        if self.pyusb_dev is not None and HAS_PYUSB:
            try:
                usb.util.dispose_resources(self.pyusb_dev)
            except Exception:
                pass


def find_usblp_device() -> Optional[Tuple[str, int, int]]:
    """Finds an active /dev/usb/lp* device and reads its VID/PID from sysfs."""
    lp_nodes = sorted(glob.glob("/dev/usb/lp*"))
    for node in lp_nodes:
        dev_name = os.path.basename(node)
        sysfs_path = f"/sys/class/usbmisc/{dev_name}/device"
        vid = 0x09C7
        pid = 0x0011
        try:
            vendor_file = os.path.realpath(os.path.join(sysfs_path, "../idVendor"))
            product_file = os.path.realpath(os.path.join(sysfs_path, "../idProduct"))
            if os.path.exists(vendor_file):
                with open(vendor_file, "r") as f:
                    vid = int(f.read().strip(), 16)
            if os.path.exists(product_file):
                with open(product_file, "r") as f:
                    pid = int(f.read().strip(), 16)
            if vid in KNOWN_VENDOR_IDS:
                return (node, vid, pid)
        except Exception:
            pass
        return (node, vid, pid)
    return None


def find_usb_printer(timeout: float = 0.0) -> Optional[USBPrinterDevice]:
    """Finds a supported USB thermal printer, optionally waiting up to `timeout` seconds."""
    start = time.time()
    while True:
        # 1. First check if a kernel character device /dev/usb/lp* is present
        lp_info = find_usblp_device()
        if lp_info is not None:
            lp_path, vid, pid = lp_info
            desc = "P12" if pid == 0x0011 else ("P15" if pid == 0x00D1 else "Thermal Printer")
            pydev = None
            if HAS_PYUSB:
                try:
                    pydev = usb.core.find(idVendor=vid, idProduct=pid)
                except Exception:
                    pass
            return USBPrinterDevice(
                pyusb_dev=pydev,
                lp_path=lp_path,
                id_vendor=vid,
                id_product=pid,
                manufacturer="YXWL" if vid == 0x09C7 else "USB",
                product=desc,
            )

        # 2. Check via PyUSB
        if HAS_PYUSB:
            for vid, pid, desc in SUPPORTED_DEVICES:
                try:
                    dev = usb.core.find(idVendor=vid, idProduct=pid)
                    if dev is not None:
                        try:
                            mfr = dev.manufacturer or "YXWL"
                            prod = dev.product or desc
                        except Exception:
                            mfr, prod = "YXWL", desc
                        return USBPrinterDevice(
                            pyusb_dev=dev,
                            id_vendor=dev.idVendor,
                            id_product=dev.idProduct,
                            manufacturer=mfr,
                            product=prod,
                        )
                except Exception:
                    pass

            for vid in KNOWN_VENDOR_IDS:
                try:
                    dev = usb.core.find(idVendor=vid)
                    if dev is not None:
                        try:
                            mfr = dev.manufacturer or "Printer"
                            prod = dev.product or "Printer"
                        except Exception:
                            mfr, prod = "USB", "Printer"
                        return USBPrinterDevice(
                            pyusb_dev=dev,
                            id_vendor=dev.idVendor,
                            id_product=dev.idProduct,
                            manufacturer=mfr,
                            product=prod,
                        )
                except Exception:
                    pass

        if timeout <= 0 or (time.time() - start) >= timeout:
            break
        time.sleep(0.5)

    return None


def query_printer_info(printer: USBPrinterDevice) -> Dict[str, str]:
    """Queries model, firmware version, and battery percentage from the printer."""
    info = {"model": "Unknown", "firmware": "Unknown", "battery": "Unknown", "status": "Ready"}
    lp_path = getattr(printer, "lp_path", None)
    if lp_path and os.path.exists(lp_path):
        try:
            fd = os.open(lp_path, os.O_RDWR | os.O_NONBLOCK)
            # Drain
            while True:
                r, _, _ = select.select([fd], [], [], 0.02)
                if r:
                    os.read(fd, 64)
                else:
                    break

            # Model query: 10 FF 20 F0
            os.write(fd, bytes([0x10, 0xFF, 0x20, 0xF0]))
            time.sleep(0.05)
            r, _, _ = select.select([fd], [], [], 0.2)
            if r:
                resp = os.read(fd, 64)
                info["model"] = resp.decode(errors="ignore").strip() or resp.hex()

            # Firmware query: 10 FF 20 F1
            os.write(fd, bytes([0x10, 0xFF, 0x20, 0xF1]))
            time.sleep(0.05)
            r, _, _ = select.select([fd], [], [], 0.2)
            if r:
                resp = os.read(fd, 64)
                info["firmware"] = resp.decode(errors="ignore").strip() or resp.hex()

            # Battery query: 10 FF 50 F1
            os.write(fd, bytes([0x10, 0xFF, 0x50, 0xF1]))
            time.sleep(0.05)
            r, _, _ = select.select([fd], [], [], 0.2)
            if r:
                resp = os.read(fd, 64)
                if len(resp) >= 2:
                    info["battery"] = f"{resp[1]}%"
                elif len(resp) == 1:
                    info["battery"] = f"{resp[0]}%"

            # Status query: 10 FF 40
            os.write(fd, bytes([0x10, 0xFF, 0x40]))
            time.sleep(0.05)
            r, _, _ = select.select([fd], [], [], 0.2)
            if r:
                resp = os.read(fd, 64)
                code = resp[0] if len(resp) > 0 else 0
                status_map = {0: "Ready / OK", 1: "Out of Paper", 2: "Cover Open", 3: "Overheated", 4: "Low Battery"}
                info["status"] = status_map.get(code, f"Code 0x{code:02x}")

            os.close(fd)
        except Exception as e:
            info["error"] = str(e)
    return info


def send_usb_data(
    printer: Union[USBPrinterDevice, any],
    data: bytes,
    chunk_size: int = 64,
    delay: float = 0.005,
) -> bool:
    """Sends raw bytes to the USB printer via /dev/usb/lp* or PyUSB bulk transfer."""
    lp_path = getattr(printer, "lp_path", None)
    if lp_path and os.path.exists(lp_path):
        try:
            with open(lp_path, "wb") as f:
                for i in range(0, len(data), chunk_size):
                    chunk = data[i:i + chunk_size]
                    f.write(chunk)
                    f.flush()
                    if delay > 0:
                        time.sleep(delay)
            return True
        except Exception as e:
            print(f"Write to {lp_path} failed ({e}), falling back to PyUSB...", file=sys.stderr)

    pydev = getattr(printer, "pyusb_dev", printer)
    if pydev is not None and HAS_PYUSB:
        try:
            if hasattr(pydev, "is_kernel_driver_active"):
                if pydev.is_kernel_driver_active(0):
                    try:
                        pydev.detach_kernel_driver(0)
                    except Exception:
                        pass
                try:
                    pydev.set_configuration()
                except Exception:
                    pass

                cfg = pydev.get_active_configuration()
                intf = cfg[(0, 0)]
                ep_out = None
                for ep in intf:
                    if usb.util.endpoint_direction(ep.bEndpointAddress) == usb.util.ENDPOINT_OUT:
                        ep_out = ep.bEndpointAddress
                        break
                if ep_out is None:
                    ep_out = 0x01

                for i in range(0, len(data), chunk_size):
                    chunk = data[i:i + chunk_size]
                    pydev.write(ep_out, chunk, timeout=3000)
                    if delay > 0:
                        time.sleep(delay)
                return True
        except Exception as e:
            print(f"PyUSB Transfer Error: {e}", file=sys.stderr)
            return False

    print("Error: No valid USB connection method available.", file=sys.stderr)
    return False


def build_l11_payload(
    bitmap: Image.Image,
    feed_mm: float = 5.0,
    density: int = 3,
    paper_type: str = "continuous",
    is_p12: bool = True,
) -> bytes:
    """Encodes bitmap into the L11 column-major binary stream.

    paper_type: 'continuous' feeds dot lines (1B 4A) to avoid runaway feed.
                'gap' feeds until optical sensor notch (1D 0C).
    """
    payload = newprint_withfeed.bitmap_to_packet(bitmap)
    canvas_width = bitmap.width
    feed_dots = max(0, min(255, round(feed_mm * 8)))

    packets = []
    if is_p12:
        # P12 hardware uses thickness control command (0=light, 1=normal, 2=dark)
        # Map density (1-5) to thickness (0-2):
        thickness = 0 if density <= 1 else (1 if density == 2 else 2)
        packets.append(bytes([0x10, 0xFF, 0x10, 0x00, thickness]))
    else:
        # P15 hardware supports explicit density command (1-5)
        packets.append(bytes([0x1F, 0x70, 0x02, max(1, min(5, density))]))
    packets.extend([
        bytes([0x10, 0xFF, 0x40]),                            # Init / status query
        bytes([
            *([0x00] * 15),                                   # Wakeup padding
            0x10, 0xFF, 0xF1, 0x02,                           # Enable engine
            0x1D, 0x76, 0x30, 0x00,                           # Print bitmap header
            0x0C, 0x00,                                       # Line byte width
            canvas_width & 0xFF, (canvas_width >> 8) & 0xFF   # Width
        ]),
        payload,
    ])

    if paper_type.lower() == "gap":
        packets.append(bytes([0x1D, 0x0C]))                   # Optical gap feed
    else:
        packets.append(bytes([0x1B, 0x4A, feed_dots]))        # Dot feed (ESC J)

    packets.append(bytes([0x10, 0xFF, 0xF1, 0x45]))           # Stop / session end
    return b"".join(packets)


def build_escpos_payload(bitmap: Image.Image, feed_mm: float = 5.0) -> bytes:
    """Encodes bitmap into ESC/POS row-major raster stream."""
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
    paper_type: str = "continuous",
    width_mm: float = 40.0,
    height_mm: float = 12.0,
    feed_mm: float = 5.0,
    density: int = 3,
    border: bool = False,
    font_scale: float = 1.0,
    wait_timeout: float = 0.0,
) -> bool:
    printer = find_usb_printer(timeout=wait_timeout)
    if printer is None:
        print("Error: Could not find USB printer.", file=sys.stderr)
        print("Supported devices: " + ", ".join(f"{v:04x}:{p:04x} ({d})" for v, p, d in SUPPORTED_DEVICES), file=sys.stderr)
        print("Please verify the printer is connected, turned ON (power button LED lit), and not asleep.", file=sys.stderr)
        return False

    print(f"Found USB printer: {printer}")

    if printer.is_p15:
        print("WARNING: Detected Pristar / Marklife P15 (09c7:00d1 / YICHIP YC3121).", file=sys.stderr)
        print("Note: The P15 factory firmware leaves the USB descriptor open but does NOT route USB data", file=sys.stderr)
        print("to the thermal printhead. USB printing is non-functional on P15 without a firmware update.", file=sys.stderr)
        print("Please use Bluetooth Low Energy (cli.py label -a <MAC>) or the ESP32-C3 Wi-Fi Gateway instead.\n", file=sys.stderr)
    info = query_printer_info(printer)
    if info.get("model") != "Unknown":
        print(f"Device Info: Model={info['model']}, Firmware={info['firmware']}, Battery={info['battery']}, Status={info['status']}")

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
        data = build_l11_payload(
            img,
            feed_mm=feed_mm,
            density=density,
            paper_type=paper_type,
            is_p12=printer.is_p12,
        )

    print(f"Sending {len(data)} bytes over USB using '{protocol.upper()}' protocol (paper={paper_type})...")
    success = send_usb_data(printer, data)
    printer.close()

    if success:
        print("Print job sent successfully over USB!")
    else:
        print("Print job failed to send.", file=sys.stderr)
    return success


def main():
    parser = argparse.ArgumentParser(description="Print labels via USB to Marklife/Pristar P12/P15 printers.")
    parser.add_argument("text", nargs="?", default=None, help="Text to print on the label (supports \\n for multiple lines)")
    parser.add_argument("--info", "-i", action="store_true", help="Query and display printer information and battery level")
    parser.add_argument("--qr", "-q", help="Optional QR code content")
    parser.add_argument("--protocol", "-p", choices=["l11", "escpos"], default="l11", help="Protocol mode (default: l11)")
    parser.add_argument("--paper", choices=["continuous", "gap"], default="continuous", help="Paper type: 'continuous' uses safe dot feed; 'gap' feeds to optical notch (default: continuous)")
    parser.add_argument("--width", "-w", type=float, default=40.0, help="Label width in mm (default: 40.0)")
    parser.add_argument("--height", "-H", type=float, default=12.0, help="Label height in mm (default: 12.0)")
    parser.add_argument("--feed", "-f", type=float, default=5.0, help="Feed paper advance in mm (default: 5.0)")
    parser.add_argument("--density", "-d", type=int, default=3, choices=[1, 2, 3, 4, 5], help="Print density (default: 3)")
    parser.add_argument("--border", "-b", action="store_true", help="Draw a border around the label")
    parser.add_argument("--scale", "-s", type=float, default=1.0, help="Font scale factor (default: 1.0)")
    parser.add_argument("--wait", "-W", type=float, default=0.0, help="Wait up to N seconds for printer to connect")

    args = parser.parse_args()

    if args.info:
        printer = find_usb_printer(timeout=args.wait)
        if printer is None:
            print("Error: Printer not found.", file=sys.stderr)
            sys.exit(1)
        print(f"Connected: {printer}")
        info = query_printer_info(printer)
        for k, v in info.items():
            print(f"  {k.capitalize()}: {v}")
        sys.exit(0)

    if not args.text:
        parser.print_help()
        sys.exit(1)

    success = print_usb_label(
        text=args.text,
        qr=args.qr,
        protocol=args.protocol,
        paper_type=args.paper,
        width_mm=args.width,
        height_mm=args.height,
        feed_mm=args.feed,
        density=args.density,
        border=args.border,
        font_scale=args.scale,
        wait_timeout=args.wait,
    )
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
