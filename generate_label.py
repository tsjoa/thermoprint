#!/usr/bin/env python3
"""
Utility script to generate label JSON templates (matching example_with_qrcode.json format)
with automatic text and QR code placement.
"""

import json
import sys
import uuid
import argparse

def generate_label(text, qr_content=None, width_mm=40, height_mm=12, font_size=30, show_qr=True):
    formatted_text = text.replace('\\n', '\n')
    qr_text = qr_content if qr_content else formatted_text.replace('\n', ' ')
    width_px = int(width_mm * 8)
    height_px = int(height_mm * 8)

    elements = []
    if show_qr:
        text_width = int(width_px * 0.72)
        qr_size = int(height_px * 0.7)
        qr_x = width_px - qr_size - 21
        qr_y = max(0, (height_px - qr_size) // 2)

        elements.append({
            "id": str(uuid.uuid4()),
            "type": "text",
            "x": -7,
            "y": max(0, (height_px - int(font_size * 1.8)) // 2),
            "width": text_width,
            "height": int(height_px * 0.65),
            "rotation": 0,
            "props": {
                "text": formatted_text,
                "fontSize": font_size,
                "fontFamily": "Inter",
                "fontWeight": 600,
                "letterSpacing": 0,
                "fill": "#000000",
                "align": "center",
                "italic": False
            }
        })
        elements.append({
            "id": str(uuid.uuid4()),
            "type": "qrcode",
            "x": qr_x,
            "y": qr_y,
            "width": qr_size,
            "height": qr_size,
            "rotation": 0,
            "props": {
                "content": qr_text,
                "errorCorrectionLevel": "M"
            }
        })
    else:
        elements.append({
            "id": str(uuid.uuid4()),
            "type": "text",
            "x": 0,
            "y": max(0, (height_px - int(font_size * 1.8)) // 2),
            "width": width_px,
            "height": int(height_px * 0.65),
            "rotation": 0,
            "props": {
                "text": formatted_text,
                "fontSize": font_size,
                "fontFamily": "Inter",
                "fontWeight": 600,
                "letterSpacing": 0,
                "fill": "#000000",
                "align": "center",
                "italic": False
            }
        })

    return {
        "name": formatted_text.split('\n')[0] or "Label",
        "label": {
            "widthMm": width_mm,
            "heightMm": height_mm,
            "widthPx": width_px,
            "heightPx": height_px
        },
        "elements": elements
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate thermal print label JSON with matching QR code.")
    parser.add_argument("text", help="Text to put on the label (use \\n for newlines)")
    parser.add_argument("-q", "--qr", help="Custom QR code content (defaults to label text)")
    parser.add_argument("-o", "--out", help="Output file path (prints JSON to stdout if omitted)")
    parser.add_argument("--width-mm", type=float, default=40, help="Width in mm (default: 40)")
    parser.add_argument("--height-mm", type=float, default=12, help="Height in mm (default: 12)")
    parser.add_argument("--font-size", type=int, default=30, help="Font size in px (default: 30)")
    parser.add_argument("--no-qr", action="store_true", help="Disable QR code generation")

    args = parser.parse_args()

    data = generate_label(
        text=args.text,
        qr_content=args.qr,
        width_mm=args.width_mm,
        height_mm=args.height_mm,
        font_size=args.font_size,
        show_qr=not args.no_qr
    )

    json_output = json.dumps(data, indent=2)

    if args.out:
        with open(args.out, "w") as f:
            f.write(json_output)
        print(f"Generated label template saved to: {args.out}")
    else:
        print(json_output)
