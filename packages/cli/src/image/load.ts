import sharp from "sharp";
import type { RawImageData } from "@thermoprint/core";

export interface LoadImageOptions {
  rotate?: boolean;
}

/**
 * Load an image from a file path and resize to target width.
 * Landscape images are auto-rotated to portrait (since the printer feeds vertically).
 * Returns raw RGBA pixel data suitable for the core image pipeline.
 */
export async function loadImage(
  filePath: string,
  width: number,
  options: LoadImageOptions = {},
): Promise<RawImageData> {
  const { rotate = true } = options;

  let pipeline = sharp(filePath);

  // Auto-rotate landscape images to portrait for vertical-feed printers
  if (rotate) {
    const metadata = await sharp(filePath).metadata();
    if (metadata.width && metadata.height && metadata.width > metadata.height) {
      pipeline = pipeline.rotate(90);
    }
  }

  const { data, info } = await pipeline
    .resize({ width, withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

/**
 * Trim whitespace from RGBA image so we only send the content area to the printer.
 * Height is padded to a multiple of 8 (required by column-major bitmap encoding).
 */
export async function trimImage(image: RawImageData): Promise<RawImageData> {
  try {
    const { data: trimBuf, info } = await sharp(Buffer.from(image.data), {
      raw: { width: image.width, height: image.height, channels: 4 },
    })
      .trim()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Pad height to multiple of 8 (required by column-major encoding)
    const paddedH = Math.ceil(info.height / 8) * 8;
    if (paddedH !== info.height) {
      const padded = new Uint8Array(info.width * paddedH * 4);
      padded.fill(255); // white
      padded.set(trimBuf);
      return { data: padded, width: info.width, height: paddedH };
    }

    return { data: new Uint8Array(trimBuf), width: info.width, height: info.height };
  } catch {
    return image;
  }
}

