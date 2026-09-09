#!/usr/bin/env python3
"""
Thermoprint Cross-Platform CLI
Command-line tool to discover and print labels on Marklife P12 / P15 / P7 printers via BLE.
"""

import argparse
import asyncio
import os
import sys
from PIL import Image

from generate_label import generate_label
from newprint_withfeed import construct_bitmap, bitmap_to_packet
from thermoprint_ble import scan_printers, print_bitmap_bleak
from usb_print import find_usb_printer, send_usb_data, build_l11_payload
import socket

def send_tcp_data(host: str, port: int, data: bytes) -> bool:
    """Sends raw L11 print stream to an ESP32-C3 network printer gateway."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(10.0)
        s.connect((host, port))
        s.sendall(data)
        s.close()
        return True
    except Exception as e:
        print(f"Network Gateway Error ({host}:{port}): {e}", file=sys.stderr)
        return False


def cmd_discover(args):
    """Scan and list nearby BLE thermal printers."""
    print(f"Scanning for BLE printers ({args.timeout}s)...")
    printers = asyncio.run(scan_printers(timeout=args.timeout, show_all=args.all))

    if not printers:
        print("No printers found. Make sure your printer is turned on and Bluetooth is enabled.")
        sys.exit(0)

    print(f"\nFound {len(printers)} device(s):\n")
    for p in printers:
        mark = " [PRINTER]" if p["is_printer"] else ""
        print(f"  {p['name']:<20} {p['address']:<24} RSSI: {p['rssi']:<5} {p['model']}{mark}")
    print()


DEFAULT_PRINTER_ADDRESS = "5E:55:09:26:72:D3"


async def resolve_address(address_arg: str = None) -> str:
    """Returns explicit address if provided, otherwise scans and returns the first compatible printer found."""
    if address_arg:
        return address_arg

    print("No address specified, scanning for a compatible printer...")
    printers = await scan_printers(timeout=5.0)
    if not printers:
        raise RuntimeError(
            "No compatible BLE printer found. Make sure it's powered on and in range, "
            "or pass -a/--address explicitly."
        )

    printer = printers[0]
    print(f"Found {printer['name']} ({printer['address']}).")
    return printer["address"]


from thermoprint import format_label_preview

def cmd_label(args):
    """Renders text label and prints over BLE."""
    current_text = args.text.replace('\\n', '\n') if args.text else ""

    if not current_text and args.interactive:
        print("\nEnter label text (use \\n for newlines):")
        try:
            inp = input("> ").strip()
            if not inp:
                print("Cancelled.")
                sys.exit(0)
            current_text = inp.replace('\\n', '\n')
        except (KeyboardInterrupt, EOFError):
            print("\nCancelled.")
            sys.exit(0)

    if args.interactive:
        while True:
            preview = format_label_preview(current_text, show_qr=not args.no_qr)
            print("\nLabel Preview:")
            print(preview)
            print()
            print("[Enter] Print  |  [e] Edit text  |  [q/Esc] Cancel")
            try:
                choice = input("> ").strip().lower()
            except (KeyboardInterrupt, EOFError):
                print("\nCancelled.")
                sys.exit(0)

            if choice in ("", "y", "p", "print", "yes"):
                break
            elif choice == "e":
                print("\nEnter new text (use \\n for newlines):")
                try:
                    new_input = input("> ").strip()
                    if new_input:
                        current_text = new_input.replace('\\n', '\n')
                except (KeyboardInterrupt, EOFError):
                    print("\nCancelled.")
                    sys.exit(0)
            elif choice in ("q", "quit", "exit", "c", "cancel"):
                print("Cancelled.")
                sys.exit(0)
    else:
        preview = format_label_preview(current_text, show_qr=not args.no_qr)
        print("\nLabel Preview:")
        print(preview)
        print()

    bitmap = construct_bitmap(
        text=current_text,
        font_size=args.font_size,
        font_family=args.font_family,
        bold=args.bold,
        italic=args.italic,
        underline=args.underline,
        canvas_height=int(args.height_mm * 8),
        width_mm=args.width_mm,
        height_mm=args.height_mm,
        show_qr=not args.no_qr,
        qr_content=args.qr,
        border=args.border,
        font_scale=args.font_scale,
        min_font_size=args.min_font_size,
        max_font_size=args.max_font_size,
    )

    payload = bitmap_to_packet(bitmap)

    if args.dry_run:
        print(f"[DRY-RUN] Rendered bitmap: {bitmap.size[0]}x{bitmap.size[1]} px, {len(payload)} bytes payload.")
        if args.save_image:
            bitmap.convert("RGB").save(args.save_image)
            print(f"[DRY-RUN] Saved preview to {args.save_image}")
        return
    if getattr(args, "gateway", None):
        host_port = args.gateway.split(":")
        host = host_port[0]
        port = int(host_port[1]) if len(host_port) > 1 else 9100
        print(f"Sending print job to ESP32-C3 Gateway at {host}:{port}...")
        net_data = build_l11_payload(bitmap, feed_mm=args.feed_mm)
        success = send_tcp_data(host, port, net_data)
        if success:
            print("Done (sent to ESP32-C3 Gateway over Wi-Fi)!")
        else:
            sys.exit(1)
        return

    if getattr(args, "usb", False):
        dev = find_usb_printer()
        if dev is None:
            print("Error: No USB printer (09c7:00d1) found. Check USB cable/connection.", file=sys.stderr)
            sys.exit(1)
        print(f"Connecting to USB printer: ID {dev.idVendor:04x}:{dev.idProduct:04x}...")
        usb_data = build_l11_payload(bitmap, feed_mm=args.feed_mm)
        success = send_usb_data(dev, usb_data)
        try:
            import usb.util
            usb.util.dispose_resources(dev)
        except Exception:
            pass
        if success:
            print("Done (printed over USB)!")
        else:
            print("USB print failed.", file=sys.stderr)
            sys.exit(1)
        return

    address = asyncio.run(resolve_address(args.address))
    print(f"Connecting to printer at {address}...")

    success = asyncio.run(
        print_bitmap_bleak(
            address=address,
            bitmap_payload=payload,
            canvas_width=bitmap.width,
            segmented_paper=args.segmented_paper,
            feed_mm=args.feed_mm,
            progress_callback=print,
        )
    )

    if success:
        print("Done!")
    else:
        print("Print failed.")


def cmd_print_image(args):
    """Prints an image file directly."""
    if not os.path.exists(args.file):
        print(f"Error: File not found: {args.file}")
        sys.exit(1)

    img = Image.open(args.file).convert('1')
    payload = bitmap_to_packet(img)

    if args.dry_run:
        print(f"[DRY-RUN] Image {args.file}: {img.size[0]}x{img.size[1]} px, {len(payload)} bytes payload.")
        return
    if getattr(args, "gateway", None):
        host_port = args.gateway.split(":")
        host = host_port[0]
        port = int(host_port[1]) if len(host_port) > 1 else 9100
        print(f"Sending image to ESP32-C3 Gateway at {host}:{port}...")
        net_data = build_l11_payload(img, feed_mm=args.feed_mm)
        success = send_tcp_data(host, port, net_data)
        if success:
            print("Done (sent to ESP32-C3 Gateway over Wi-Fi)!")
        else:
            sys.exit(1)
        return

    if getattr(args, "usb", False):
        dev = find_usb_printer()
        if dev is None:
            print("Error: No USB printer (09c7:00d1) found. Check USB cable/connection.", file=sys.stderr)
            sys.exit(1)
        print(f"Connecting to USB printer: ID {dev.idVendor:04x}:{dev.idProduct:04x}...")
        usb_data = build_l11_payload(img, feed_mm=args.feed_mm)
        success = send_usb_data(dev, usb_data)
        try:
            import usb.util
            usb.util.dispose_resources(dev)
        except Exception:
            pass
        if success:
            print("Done (printed over USB)!")
        else:
            print("USB print failed.", file=sys.stderr)
            sys.exit(1)
        return

    address = asyncio.run(resolve_address(args.address))
    print(f"Connecting to printer at {address}...")
    asyncio.run(
        print_bitmap_bleak(
            address=address,
            bitmap_payload=payload,
            canvas_width=img.width,
            segmented_paper=args.segmented_paper,
            feed_mm=args.feed_mm,
            progress_callback=print,
        )
    )
    print("Done!")


from thermoprint_ble import set_shutdown_seconds_bleak

def cmd_power_off(args):
    """Sets the printer's auto-shutdown timer."""
    seconds = 0 if args.never else args.seconds
    address = asyncio.run(resolve_address(args.address))
    print(f"Connecting to printer at {address}...")
    sec_desc = "Never (stay on until battery runs out)" if seconds == 0 else f"{seconds} seconds"
    print(f"Setting auto-power off timer to: {sec_desc}...")
    asyncio.run(set_shutdown_seconds_bleak(address, seconds=seconds))
    print("Auto-power off setting updated successfully!")


def main():
    parser = argparse.ArgumentParser(description="Thermoprint CLI — Cross-platform Bluetooth thermal printer tool")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Discover subcommand
    p_disc = subparsers.add_parser("discover", help="Scan for nearby BLE thermal printers")
    p_disc.add_argument("-t", "--timeout", type=float, default=5.0, help="Scan timeout in seconds")
    p_disc.add_argument("--all", action="store_true", help="Show all BLE devices, not just printers")
    p_disc.set_defaults(func=cmd_discover)

    # Power-off subcommand
    p_power = subparsers.add_parser("power-off", help="Configure printer auto-power off timeout")
    p_power.add_argument("-a", "--address", default=None, help="Printer BLE MAC address (auto-discovers if omitted)")
    p_power.add_argument("-n", "--never", action="store_true", default=True, help="Keep printer powered on until battery is empty (default)")
    p_power.add_argument("-s", "--seconds", type=int, default=0, help="Auto-shutdown timeout in seconds (0 = never)")
    p_power.set_defaults(func=cmd_power_off)

    # Label subcommand
    p_label = subparsers.add_parser("label", help="Print a text label")
    p_label.add_argument("text", nargs="?", default="", help="Label text (use \\n for newlines)")
    p_label.add_argument("-i", "--interactive", action="store_true", help="Interactive prompt menu")
    p_label.add_argument("-a", "--address", default=None, help="Printer BLE MAC address (auto-discovers if omitted)")
    p_label.add_argument("-q", "--qr", help="Custom QR code text (defaults to label text)")
    p_label.add_argument("--no-qr", action="store_true", help="Disable QR code generation")
    p_label.add_argument("--font-size", type=int, default=None, help="Font size in px (auto-fit to the label if omitted)")
    p_label.add_argument("--font-scale", type=float, default=1.0, help="Multiplier applied to the auto-fit (or explicit) font size, e.g. 2.0 to double it (default: 1.0)")
    p_label.add_argument("--min-font-size", type=int, default=8, help="Smallest font size the auto-fit may choose (default: 8)")
    p_label.add_argument("--max-font-size", type=int, default=64, help="Largest font size the auto-fit may choose (default: 64)")
    p_label.add_argument("--font-family", type=str, default="Arial")
    p_label.add_argument("--bold", action="store_true")
    p_label.add_argument("--italic", action="store_true")
    p_label.add_argument("--underline", action="store_true")
    p_label.add_argument("--width-mm", type=float, default=40.0, help="Width in mm (default: 40)")
    p_label.add_argument("--height-mm", type=float, default=12.0, help="Height in mm (default: 12)")
    p_label.add_argument("-b", "--border", action="store_true", help="Draw border around label")
    p_label.add_argument("--segmented-paper", action="store_true")
    p_label.add_argument("--feed-mm", type=float, default=5.0, help="Blank paper fed out after the label, in mm (default: 5.0)")
    p_label.add_argument("--dry-run", action="store_true", help="Render only, do not send to printer")
    p_label.add_argument("--save-image", help="Save rendered label as image file")
    p_label.set_defaults(func=cmd_label)
    p_label.add_argument("-u", "--usb", action="store_true", help="Print directly via USB instead of Bluetooth")
    p_label.add_argument("-g", "--gateway", metavar="IP[:PORT]", help="Send print job over Wi-Fi to ESP32-C3 BLE gateway (e.g. 192.168.20.18)")

    # Print subcommand
    p_print = subparsers.add_parser("print", help="Print an image file")
    p_print.add_argument("file", help="Path to image file")
    p_print.add_argument("-a", "--address", help="Printer BLE MAC address (auto-discovers if omitted)")
    p_print.add_argument("--segmented-paper", action="store_true")
    p_print.add_argument("--feed-mm", type=float, default=5.0, help="Blank paper fed out after the image, in mm (default: 5.0)")
    p_print.add_argument("--dry-run", action="store_true", help="Render only, do not send to printer")
    p_print.set_defaults(func=cmd_print_image)

    p_print.add_argument("-u", "--usb", action="store_true", help="Print directly via USB instead of Bluetooth")
    p_print.add_argument("-g", "--gateway", metavar="IP[:PORT]", help="Send print job over Wi-Fi to ESP32-C3 BLE gateway (e.g. 192.168.20.18)")
    args = parser.parse_args()
    try:
        args.func(args)
    except RuntimeError as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
