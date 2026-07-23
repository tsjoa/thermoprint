"""
Thermoprint Python Library & API
Provides simple Python functions to print thermal labels from any Python application.
"""

import json
import os
import shutil
import subprocess
from typing import Any, Dict, Optional


class ThermoprintError(Exception):
    """Raised when label generation or printing encounters an error."""
    pass


def print_label(
    text: str,
    address: str = "03:0D:7A:D6:5E:B1",
    qr: Optional[str] = None,
    border: bool = False,
    font_size: int = 22,
    width_mm: float = 40,
    height_mm: float = 12,
    density: int = 3,
    paper_type: str = "gap",
    dry_run: bool = False,
    interactive: bool = False,
    yes: bool = True,
) -> Dict[str, Any]:
    """
    Print a text + QR code thermal label directly to a Marklife P15 BLE printer.

    Usage:
        import thermoprint
        thermoprint.print_label("RELAY-16CH\\n12V MODULE\\nREV 2.0", address="03:0D:7A:D6:5E:B1")

    Parameters:
        text (str): Label text (use '\\n' for newlines; max 16 chars per line recommended).
        address (str): Target BLE MAC address (default: "03:0D:7A:D6:5E:B1").
        qr (str, optional): Custom QR code content (defaults to label text).
        border (bool): Print fine 1px outline box around text box (default: False).
        font_size (int): Font size in px (default: 22).
        width_mm (float): Label width in mm (default: 40).
        height_mm (float): Label height in mm (default: 12).
        density (int): Print density 1-3 (default: 3).
        paper_type (str): Paper type 'gap' or 'continuous' (default: 'gap').
        dry_run (bool): Render only, do not send to printer (default: False).
        interactive (bool): Pause and prompt to review/edit text before printing.
        yes (bool): Skip confirmation prompt when called programmatically (default: True).

    Returns:
        dict: Result status or JSON metadata.
    """
    cmd = ["thermoprint", "label", text]
    if not interactive and not dry_run:
        cmd.append("--json")
    if yes and not interactive:
        cmd.append("-y")
    if interactive:
        cmd.append("-i")
    if address and not dry_run:
        cmd.extend(["-a", address])
    if qr:
        cmd.extend(["-q", qr])
    if border:
        cmd.append("-b")
    if font_size:
        cmd.extend(["--font-size", str(font_size)])
    if width_mm:
        cmd.extend(["--width-mm", str(width_mm)])
    if height_mm:
        cmd.extend(["--height-mm", str(height_mm)])
    if density:
        cmd.extend(["-d", str(density)])
    if paper_type:
        cmd.extend(["--paper", paper_type])
    if dry_run:
        cmd.append("--dry-run")

    # Fallback to local bun script if 'thermoprint' executable isn't in PATH
    if not shutil.which("thermoprint"):
        repo_dir = os.path.dirname(os.path.abspath(__file__))
        cli_entry = os.path.join(repo_dir, "packages", "cli", "src", "index.ts")
        if os.path.exists(cli_entry):
            cmd = ["bun", "run", cli_entry] + cmd[1:]
        else:
            raise ThermoprintError("'thermoprint' executable not found. Make sure Bun and thermoprint are installed.")

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        err_msg = res.stderr.strip() or res.stdout.strip()
        raise ThermoprintError(f"Failed to print label: {err_msg}")

    try:
        return json.loads(res.stdout.strip())
    except Exception:
        return {"status": "success", "raw": res.stdout.strip()}


def print_template(
    template_path_or_dict: Any,
    address: str = "03:0D:7A:D6:5E:B1",
    density: int = 3,
    paper_type: str = "gap",
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Print a custom JSON template file or dictionary to the printer.

    Parameters:
        template_path_or_dict (str | dict): Path to template file or template dict.
        address (str): Target BLE MAC address (default: "03:0D:7A:D6:5E:B1").
        density (int): Print density 1-3.
        paper_type (str): Paper type 'gap' or 'continuous'.
        dry_run (bool): Render only, do not send to printer.
    """
    cmd = ["thermoprint", "print-template"]

    input_str: Optional[str] = None
    if isinstance(template_path_or_dict, dict):
        cmd.append("-")
        input_str = json.dumps(template_path_or_dict)
    else:
        cmd.append(str(template_path_or_dict))

    if address and not dry_run:
        cmd.extend(["-a", address])
    if density:
        cmd.extend(["-d", str(density)])
    if paper_type:
        cmd.extend(["--paper", paper_type])
    if dry_run:
        cmd.append("--dry-run")
    cmd.append("--json")

    if not shutil.which("thermoprint"):
        repo_dir = os.path.dirname(os.path.abspath(__file__))
        cli_entry = os.path.join(repo_dir, "packages", "cli", "src", "index.ts")
        if os.path.exists(cli_entry):
            cmd = ["bun", "run", cli_entry] + cmd[1:]

    res = subprocess.run(cmd, input=input_str, capture_output=True, text=True)
    if res.returncode != 0:
        err_msg = res.stderr.strip() or res.stdout.strip()
        raise ThermoprintError(f"Failed to print template: {err_msg}")

    try:
        return json.loads(res.stdout.strip())
    except Exception:
        return {"status": "success", "raw": res.stdout.strip()}
