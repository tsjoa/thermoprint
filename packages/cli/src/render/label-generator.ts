import { randomUUID } from "node:crypto";

export interface CreateLabelOptions {
  text: string;
  qrContent?: string;
  widthMm?: number;
  heightMm?: number;
  fontSize?: number;
  showQr?: boolean;
  border?: boolean;
}

/**
 * Generate a JSON label template with text + QR code.
 *
 * NOTE: For 40x12mm labels with QR code at 22px font size, the maximum character length per line is 16 characters
 * (e.g. "123456789_123456"). Lines exceeding 16 characters overflow the text bounding box and will cause the printer
 * to drop the BLE connection (bluepy-helper exited error).
 */
export function generateQrLabelTemplate(options: CreateLabelOptions) {
  const {
    text,
    widthMm = 40,
    heightMm = 12,
    fontSize = 22,
    showQr = true,
    border = false,
  } = options;

  // Unescape literal \n strings if passed from CLI
  const formattedText = text.replace(/\\n/g, "\n");
  const qrContent = options.qrContent || formattedText.replace(/\n/g, " ");

  const widthPx = Math.round(widthMm * 8); // 320px
  const heightPx = Math.round(heightMm * 8); // 96px

  const elements: any[] = [];

  if (showQr) {
    // QR code (FIXED): 84px size, qrX = 220px, qrY = 6px
    const qrSize = 84;
    const qrX = 220;
    const qrY = Math.round((heightPx - qrSize) / 2); // 6px

    // Text box: moved another 2mm right to x = 16px, width = 196px
    const textX = 16;
    const textWidth = qrX - 8 - textX; // 220 - 8 - 16 = 196px

    const lines = formattedText.split("\n");
    const lineCount = Math.min(lines.length, 3);
    const estimatedTextHeight = fontSize + (lineCount - 1) * (fontSize * 1.2);
    const textY = Math.max(4, Math.round((heightPx - estimatedTextHeight) / 2));
    const textHeight = Math.round(estimatedTextHeight + 4);

    if (border) {
      elements.push({
        id: randomUUID(),
        type: "rect",
        x: textX,
        y: textY,
        width: textWidth,
        height: textHeight,
        rotation: 0,
        props: {
          shapeType: "rect",
          fill: "none",
          stroke: "#000000",
          strokeWidth: 1,
        },
      });
    }

    elements.push({
      id: randomUUID(),
      type: "text",
      x: textX,
      y: textY,
      width: textWidth,
      height: textHeight,
      rotation: 0,
      props: {
        text: formattedText,
        fontSize,
        fontFamily: "Inter",
        fontWeight: 600,
        letterSpacing: 0,
        fill: "#000000",
        align: "left",
        italic: false,
      },
    });

    elements.push({
      id: randomUUID(),
      type: "qrcode",
      x: qrX,
      y: qrY,
      width: qrSize,
      height: qrSize,
      rotation: 0,
      props: {
        content: qrContent,
        errorCorrectionLevel: "M",
      },
    });
  } else {
    // Full width text
    const textX = 16;
    const textWidth = widthPx - textX;

    const lines = formattedText.split("\n");
    const lineCount = Math.min(lines.length, 3);
    const estimatedTextHeight = fontSize + (lineCount - 1) * (fontSize * 1.2);
    const textY = Math.max(4, Math.round((heightPx - estimatedTextHeight) / 2));
    const textHeight = Math.round(estimatedTextHeight + 4);

    if (border) {
      elements.push({
        id: randomUUID(),
        type: "rect",
        x: textX,
        y: textY,
        width: textWidth,
        height: textHeight,
        rotation: 0,
        props: {
          shapeType: "rect",
          fill: "none",
          stroke: "#000000",
          strokeWidth: 1,
        },
      });
    }

    elements.push({
      id: randomUUID(),
      type: "text",
      x: textX,
      y: textY,
      width: textWidth,
      height: textHeight,
      rotation: 0,
      props: {
        text: formattedText,
        fontSize,
        fontFamily: "Inter",
        fontWeight: 600,
        letterSpacing: 0,
        fill: "#000000",
        align: "left",
        italic: false,
      },
    });
  }

  return {
    name: formattedText.split("\n")[0] || "Label",
    label: {
      widthMm,
      heightMm,
      widthPx,
      heightPx,
    },
    elements,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
