#!/usr/bin/env python3
"""
Thermoprint Deterministic Roll Calibration Tool
Prints a 10cm (100mm) millimeter calibration ruler and interactively
computes and stores the exact printable label geometry.
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

CONFIG_FILE = Path(__file__).parent / "calibration.json"
DEFAULT_GATEWAY = "192.168.20.18"
DEFAULT_PORT = 6053
DEFAULT_PSK = "iY3Kssct4ASmO9MGWVY0L32HnwUXjO6ujW8ETa8vbc8="


def load_calibration():
    """Loads current saved calibration if present."""
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "physical_length_mm": 42.0,
        "printable_width_mm": 38.7,
        "printable_width_px": 310,
        "printable_height_px": 96
    }


def save_calibration(physical_mm: float):
    """Calculates and stores calibrated label geometry."""
    # 1.65mm margin on each end (3.3mm total) ensures edge-to-edge framing without clipping
    printable_mm = round(max(10.0, physical_mm - 3.3), 1)
    printable_px = int(printable_mm * 8)

    data = {
        "physical_length_mm": physical_mm,
        "printable_width_mm": printable_mm,
        "printable_width_px": printable_px,
        "printable_height_px": 96,
        "margin_total_mm": 3.3
    }
    with open(CONFIG_FILE, "w") as f:
        json.dump(data, f, indent=2)
    return data


async def run_ruler_print(gateway_ip: str, max_mm: float = 100.0):
    """Sends 10cm calibration ruler print job via ESPHome Native API."""
    from aioesphomeapi import APIClient

    client = APIClient(
        address=gateway_ip,
        port=DEFAULT_PORT,
        password="",
        noise_psk=DEFAULT_PSK
    )
    print(f"Connecting to ESP32 Gateway at {gateway_ip}...")
    await client.connect(login=True)
    _, services = await client.list_entities_services()
    svc = next((s for s in services if s.name == "print_calibration_ruler"), None)
    if not svc:
        await client.disconnect()
        raise RuntimeError("Gateway does not expose 'print_calibration_ruler' service.")

    print(f"Printing 10cm ({max_mm}mm) Millimeter Calibration Ruler...")
    await client.execute_service(svc, {"max_mm": float(max_mm)})
    await asyncio.sleep(2)
    await client.disconnect()


async def run_confirmation_print(gateway_ip: str, printable_mm: float, physical_mm: float):
    """Prints confirmation label using newly calibrated width."""
    from aioesphomeapi import APIClient

    client = APIClient(
        address=gateway_ip,
        port=DEFAULT_PORT,
        password="",
        noise_psk=DEFAULT_PSK
    )
    await client.connect(login=True)
    _, services = await client.list_entities_services()
    svc = next((s for s in services if s.name == "print_text"), None)
    if svc:
        text = f"CALIBRATED OK\nRoll: {physical_mm}mm\nWidth: {printable_mm}mm"
        print(f"Printing confirmation label at {printable_mm}mm width...")
        await client.execute_service(svc, {
            "label_text": text,
            "width_mm": printable_mm,
            "feed_mm": 5.0,
            "density": 3
        })
    await asyncio.sleep(2)
    await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Deterministic Roll Calibration for BLE Thermal Printers")
    parser.add_argument("--gateway", default=DEFAULT_GATEWAY, help="ESP32 Gateway IP address (default: 192.168.20.18)")
    parser.add_argument("--span-mm", type=float, default=100.0, help="Ruler length in mm (default: 100mm / 10cm)")
    parser.add_argument("--show", action="store_true", help="Show current saved calibration and exit")
    parser.add_argument("--set-mm", type=float, help="Manually set physical roll length in mm without printing ruler")
    args = parser.parse_args()

    if args.show:
        cal = load_calibration()
        print("\nCurrent Saved Calibration:")
        print(json.dumps(cal, indent=2))
        return

    if args.set_mm:
        cal = save_calibration(args.set_mm)
        print(f"\nSaved calibration for {args.set_mm}mm roll:")
        print(f"  -> Printable Width: {cal['printable_width_mm']} mm ({cal['printable_width_px']} px)")
        return

    print("==========================================================")
    print("      DETERMINISTIC BLE PRINTER ROLL CALIBRATION         ")
    print("==========================================================")
    print("Step 1: Printing a 10cm (100mm) ruler across your label roll.")
    print("        The printer will automatically halt at the gap.\n")

    try:
        asyncio.run(run_ruler_print(args.gateway, max_mm=args.span_mm))
    except Exception as e:
        print(f"Error printing calibration ruler: {e}", file=sys.stderr)
        sys.exit(1)

    print("\n----------------------------------------------------------")
    print("Step 2: Inspect the FIRST label that came out.")
    print("        Find the millimeter number printed right before the")
    print("        gap / cut edge of label #1.")
    print("----------------------------------------------------------")

    while True:
        try:
            val = input("\nEnter observed length in mm (e.g. 42, 30, 50): ").strip()
            if not val:
                continue
            physical_mm = float(val)
            if physical_mm <= 5 or physical_mm > 200:
                print("Please enter a realistic label length between 10mm and 150mm.")
                continue
            break
        except ValueError:
            print("Invalid number. Please enter a numerical value (e.g. 42 or 42.5).")
        except (KeyboardInterrupt, EOFError):
            print("\nCalibration cancelled.")
            sys.exit(0)

    cal = save_calibration(physical_mm)
    print("\n==========================================================")
    print("               CALIBRATION SUCCESSFUL                     ")
    print("==========================================================")
    print(f"  * Physical Roll Length:  {cal['physical_length_mm']} mm")
    print(f"  * Margin Allowance:      {cal['margin_total_mm']} mm (1.65mm on each end)")
    print(f"  * Calibrated Width:      {cal['printable_width_mm']} mm ({cal['printable_width_px']} px)")
    print(f"  * Saved Configuration:   {CONFIG_FILE}")
    print("==========================================================\n")

    confirm = input("Would you like to print a confirmation test label now? (y/n): ").strip().lower()
    if confirm in ("y", "yes", ""):
        asyncio.run(run_confirmation_print(args.gateway, cal["printable_width_mm"], cal["physical_length_mm"]))
        print("Confirmation test printed!")


if __name__ == "__main__":
    main()
