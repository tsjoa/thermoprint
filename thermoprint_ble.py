"""
Cross-platform BLE transport and discovery module for Marklife P12 / P15 / P7 printers using Bleak.
Works natively on Windows, macOS, and Linux.
"""

import asyncio
import time
from typing import List, Dict, Optional, Tuple
from bleak import BleakScanner, BleakClient

SERVICE_UUID = "0000ff00-0000-1000-8000-00805f9b34fb"
CHAR_UUID = "0000ff02-0000-1000-8000-00805f9b34fb"

PRINTER_NAME_PREFIXES = ("P12_", "P15_", "P7_", "Marklife", "Phomemo")


async def scan_printers(timeout: float = 5.0, show_all: bool = False) -> List[Dict[str, str]]:
    """
    Scans for BLE devices and returns matching printers (or all devices if show_all=True).
    """
    discovered = await BleakScanner.discover(return_adv=True, timeout=timeout)
    results = []

    for device, adv in discovered.values():
        name = device.name or adv.local_name or ""
        address = device.address
        rssi = adv.rssi
        service_uuids = adv.service_uuids or []

        is_printer = (
            any(name.startswith(p) for p in PRINTER_NAME_PREFIXES)
            or SERVICE_UUID.lower() in [u.lower() for u in service_uuids]
        )

        if show_all or is_printer:
            model = "Marklife / L11" if is_printer else "Unknown"
            results.append({
                "name": name if name else "(no name)",
                "address": address,
                "rssi": str(rssi),
                "model": model,
                "is_printer": is_printer,
            })

    return results


DOTS_PER_MM = 8  # matches the 8 px/mm bitmap scale used elsewhere (203 dpi print head)


async def print_bitmap_bleak(
    address: str,
    bitmap_payload: bytes,
    canvas_width: int,
    segmented_paper: bool = False,
    feed_mm: float = 5.0,
    progress_callback: Optional[callable] = None,
) -> bool:
    """
    Connects to the printer via Bleak and streams print packets.

    feed_mm controls the blank paper fed out after the label before the
    stop command, using the L11 protocol's dot-precise "ESC J" feed
    command (`1B 4A NN`, NN = dot count) instead of a fixed number of
    raw line-feed bytes.
    """
    feed_dots = max(0, min(255, round(feed_mm * DOTS_PER_MM)))

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
        bitmap_payload,
        bytes([0x1b, 0x4a, feed_dots]),  # ESC J: feed feed_dots dots
    ]

    if segmented_paper:
        packets.extend([
            bytes([0x1d, 0x0c, 0x10]),
            bytes([0xff, 0xf1, 0x45]),
            bytes([0x10, 0xff, 0x40]),
            bytes([0x10, 0xff, 0x40]),
        ])
    else:
        packets.extend([
            bytes([0x10, 0xff, 0xf1, 0x45])
        ])

    async with BleakClient(address) as client:
        if not client.is_connected:
            raise RuntimeError(f"Could not connect to BLE device at {address}")

        if progress_callback:
            progress_callback("Connected. Sending print payload...")

        for p in packets:
            chunks = [p[i:i + 96] for i in range(0, len(p), 96)]
            for chunk in chunks:
                await client.write_gatt_char(CHAR_UUID, chunk, response=False)
                await asyncio.sleep(0.03)

        if progress_callback:
            progress_callback("Print payload sent successfully.")

    return True


async def set_shutdown_seconds_bleak(address: str, seconds: int = 0) -> bool:
    """
    Sets the printer's auto-shutdown timer in seconds over BLE (L11 protocol).
    seconds = 0 disables auto-power off (stays on until battery runs out).
    """
    hh = (seconds >> 8) & 0xFF
    ll = seconds & 0xFF
    cmd = bytes([0x10, 0xFF, 0x12, hh, ll])

    async with BleakClient(address) as client:
        if not client.is_connected:
            raise RuntimeError(f"Could not connect to BLE device at {address}")
        await client.write_gatt_char(CHAR_UUID, cmd, response=False)
        await asyncio.sleep(0.1)

    return True
