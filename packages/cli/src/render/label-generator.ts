import { randomUUID } from "node:crypto";

export interface CreateLabelOptions {
  text: string;
  qrContent?: string;
  widthMm?: number;
  heightMm?: number;
  fontSize?: number;
  showQr?: boolean;
}

export function generateQrLabelTemplate(options: CreateLabelOptions) {
  const {
    text,
    widthMm = 40,
    heightMm = 12,
    fontSize = 22,
    showQr = true,
  } = options;

  // Unescape literal \n strings if passed from CLI
  const formattedText = text.replace(/\\n/g, "\n");
  const qrContent = options.qrContent || formattedText.replace(/\n/g, " ");

  const widthPx = Math.round(widthMm * 8); // 320px
  const heightPx = Math.round(heightMm * 8); // 96px

  // Printer feed offset shift (~32px / 4mm) to align physical paper edges
  const feedShiftX = 32;

  const elements: any[] = [];

  if (showQr) {
    // QR code: 76px x 76px (9.5mm), centered vertically at y = 10px
    // Positioned 32px before right edge of canvas to leave 0.5mm physical margin
    const qrSize = 76;
    const qrX = widthPx - feedShiftX - qrSize; // 320 - 32 - 76 = 212px
    const qrY = Math.round((heightPx - qrSize) / 2); // 10px

    // Text box: left offset -16px, width 220px to center text within physical left margin & QR code
    const textX = -16;
    const textWidth = qrX - 8 - textX; // 212 - 8 - (-16) = 220px

    const lines = formattedText.split("\n");
    const lineCount = Math.min(lines.length, 3);
    const estimatedTextHeight = fontSize + (lineCount - 1) * (fontSize * 1.2);
    const textY = Math.max(4, Math.round((heightPx - estimatedTextHeight) / 2));

    elements.push({
      id: randomUUID(),
      type: "text",
      x: textX,
      y: textY,
      width: textWidth,
      height: heightPx - 8,
      rotation: 0,
      props: {
        text: formattedText,
        fontSize,
        fontFamily: "Inter",
        fontWeight: 600,
        letterSpacing: 0,
        fill: "#000000",
        align: "center",
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
    const textX = -16;
    const textWidth = widthPx - feedShiftX - textX;

    const lines = formattedText.split("\n");
    const lineCount = Math.min(lines.length, 3);
    const estimatedTextHeight = fontSize + (lineCount - 1) * (fontSize * 1.2);
    const textY = Math.max(4, Math.round((heightPx - estimatedTextHeight) / 2));

    elements.push({
      id: randomUUID(),
      type: "text",
      x: textX,
      y: textY,
      width: textWidth,
      height: heightPx - 8,
      rotation: 0,
      props: {
        text: formattedText,
        fontSize,
        fontFamily: "Inter",
        fontWeight: 600,
        letterSpacing: 0,
        fill: "#000000",
        align: "center",
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
