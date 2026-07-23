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
    fontSize = 30,
    showQr = true,
  } = options;

  // Unescape literal \n strings if passed from CLI
  const formattedText = text.replace(/\\n/g, "\n");
  const qrContent = options.qrContent || formattedText.replace(/\n/g, " ");

  const widthPx = Math.round(widthMm * 8); // e.g. 40 * 8 = 320
  const heightPx = Math.round(heightMm * 8); // e.g. 12 * 8 = 96

  const elements: any[] = [];

  if (showQr) {
    const textWidth = Math.round(widthPx * 0.72); // ~230px
    const qrSize = Math.round(heightPx * 0.7); // ~67px
    const qrX = Math.round(widthPx - qrSize - 21); // ~231px
    const qrY = Math.round((heightPx - qrSize) / 2); // ~14px

    elements.push({
      id: randomUUID(),
      type: "text",
      x: -7,
      y: Math.max(0, Math.round((heightPx - fontSize * 1.8) / 2)),
      width: textWidth,
      height: Math.round(heightPx * 0.65),
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
    elements.push({
      id: randomUUID(),
      type: "text",
      x: 0,
      y: Math.max(0, Math.round((heightPx - fontSize * 1.8) / 2)),
      width: widthPx,
      height: Math.round(heightPx * 0.65),
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
