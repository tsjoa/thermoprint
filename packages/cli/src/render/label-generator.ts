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

  const marginMm = 0.5;
  const marginPx = Math.round(marginMm * 8); // 4px margin (0.5mm)

  const widthPx = Math.round(widthMm * 8); // e.g. 40 * 8 = 320
  const heightPx = Math.round(heightMm * 8); // e.g. 12 * 8 = 96

  const availableH = heightPx - marginPx * 2; // 88px

  const elements: any[] = [];

  if (showQr) {
    // QR code: aligned to right margin (0.5mm / 4px from right)
    const qrSize = Math.min(84, availableH); // 84px size
    const qrX = widthPx - marginPx - qrSize; // 320 - 4 - 84 = 232px
    const qrY = Math.round((heightPx - qrSize) / 2); // 6px (centered vertically with >0.5mm margin)

    // Text box: left margin 4px (0.5mm), extends to gap before QR code
    const gapPx = 4;
    const textX = marginPx; // 4px
    const textWidth = qrX - gapPx - textX; // 232 - 4 - 4 = 224px

    const lines = formattedText.split("\n");
    const lineCount = lines.length;
    const estimatedTextHeight = lineCount * (fontSize * 1.15);
    const textY = Math.max(marginPx, Math.round((heightPx - estimatedTextHeight) / 2));

    elements.push({
      id: randomUUID(),
      type: "text",
      x: textX,
      y: textY,
      width: textWidth,
      height: availableH,
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
    // Full width text with 0.5mm margins
    const textX = marginPx;
    const textWidth = widthPx - marginPx * 2;

    const lines = formattedText.split("\n");
    const lineCount = lines.length;
    const estimatedTextHeight = lineCount * (fontSize * 1.15);
    const textY = Math.max(marginPx, Math.round((heightPx - estimatedTextHeight) / 2));

    elements.push({
      id: randomUUID(),
      type: "text",
      x: textX,
      y: textY,
      width: textWidth,
      height: availableH,
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
