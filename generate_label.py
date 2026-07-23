#!/usr/bin/env python3
"""
Utility script to generate label JSON templates (matching example_with_qrcode.json format)
with automatic text and QR code placement, exact margins, left-aligned text, and 3-line support.
"""

import json
import sys
import uuid
import argparse

def generate_label(text, qr_content=None, width_mm=40, height_mm=12, font_size=22, show_qr=True):
    formatted_text = text.replace('\\n', '\n')
    qr_text = qr_content if qr_content else formatted_text.replace('\n', ' ')

    width_px = int(width_mm * 8) # 320px
    height_px = int(height_mm * 8) # 96px

    elements = []
    if show_qr:
        qr_size = 84
        qr_x = 220
        qr_y = max(4, (height_px - qr_size) // 2) # 6px

        text_x = 0
        text_width = qr_x - 8 - text_x # 212px

        lines = formatted_text.split('\n')
        line_count = min(len(lines), 3)
        estimated_text_height = font_size + (line_count - 1) * (font_size * 1.2)
        text_y = max(4, int((height_px - estimated_text_height) // 2))

        elements.append({
            "id": str(uuid.uuid4()),
            "type": "text",
            "x": text_x,
            "y": text_y,
            "width": text_width,
            "height": height_px - 8,
            "rotation": 0,
            "props": {
                "text": formatted_text,
                "fontSize": font_size,
                "fontFamily": "Inter",
                "fontWeight": 600,
                "letterSpacing": 0,
                "fill": "#000000",
                "align": "left",
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
        text_x = 0
        text_width = width_px - text_x
        lines = formatted_text.split('\n')
        line_count = min(len(lines), 3)
        estimated_text_height = font_size + (line_count - 1) * (font_size * 1.2)
        text_y = max(4, int((height_px - estimated_text_height) // 2))

        elements.append({
            "id": str(uuid.uuid4()),
            "type": "text",
            "x": text_x,
            "y": text_y,
            "width": text_width,
            "height": height_px - 8,
            "rotation": 0,
            "props": {
                "text": formatted_text,
                "fontSize": font_size,
                "fontFamily": "Inter",
                "fontWeight": 600,
                "letterSpacing": 0,
                "fill": "#000000",
                "align": "left",
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
    parser.add_argument("--font-size", type=int, default=22, help="Font size in px (default: 22)")
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
