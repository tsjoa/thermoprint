import type { ImageBitmap1bpp, PrintCommand } from "../types.js";

/** 15 zero bytes to wake the printer */
export function wakeup(): PrintCommand {
  return { label: "wakeup", data: new Uint8Array(15) };
}

/** Activate print engine: 10 FF F1 02 */
export function enable(): PrintCommand {
  return { label: "enable", data: Uint8Array.from([0x10, 0xff, 0xf1, 0x02]) };
}

/** End print session: 10 FF F1 45 */
export function stop(): PrintCommand {
  return { label: "stop", data: Uint8Array.from([0x10, 0xff, 0xf1, 0x45]) };
}

/** Set density: 1F 70 02 DD */
export function setDensity(density: number): PrintCommand {
  return {
    label: "set-density",
    data: Uint8Array.from([0x1f, 0x70, 0x02, density & 0xff]),
  };
}

/** Set thickness: 10 FF 10 00 TT */
export function setThickness(thickness: number): PrintCommand {
  return {
    label: "set-thickness",
    data: Uint8Array.from([0x10, 0xff, 0x10, 0x00, thickness & 0xff]),
  };
}

/** Feed n dots: 1B 4A NN */
export function feedDots(dots: number): PrintCommand {
  return {
    label: "feed-dots",
    data: Uint8Array.from([0x1b, 0x4a, dots & 0xff]),
  };
}

/** Feed n lines: 1B 64 NN */
export function feedLines(lines: number): PrintCommand {
  return {
    label: "feed-lines",
    data: Uint8Array.from([0x1b, 0x64, lines & 0xff]),
  };
}

/** Advance to next label gap: 1D 0C */
export function positionToGap(): PrintCommand {
  return { label: "position-to-gap", data: Uint8Array.from([0x1d, 0x0c]) };
}

/** Reverse feed: 10 FF F2 */
export function backoff(): PrintCommand {
  return { label: "backoff", data: Uint8Array.from([0x10, 0xff, 0xf2]) };
}

/** Calibrate gap sensor: 10 FF 03 */
export function learnGap(): PrintCommand {
  return { label: "learn-gap", data: Uint8Array.from([0x10, 0xff, 0x03]) };
}

/** Query battery level: 10 FF 50 F1 */
export function getBattery(): PrintCommand {
  return {
    label: "get-battery",
    data: Uint8Array.from([0x10, 0xff, 0x50, 0xf1]),
  };
}

/** Query printer status: 10 FF 40 */
export function getStatus(): PrintCommand {
  return { label: "get-status", data: Uint8Array.from([0x10, 0xff, 0x40]) };
}

/** Detailed status query: 1F 20 00 */
export function getDetailedStatus(): PrintCommand {
  return {
    label: "get-detailed-status",
    data: Uint8Array.from([0x1f, 0x20, 0x00]),
  };
}

/** Query model string: 10 FF 20 F0 */
export function getModel(): PrintCommand {
  return {
    label: "get-model",
    data: Uint8Array.from([0x10, 0xff, 0x20, 0xf0]),
  };
}

/** Query firmware version: 10 FF 20 F1 */
export function getFirmware(): PrintCommand {
  return {
    label: "get-firmware",
    data: Uint8Array.from([0x10, 0xff, 0x20, 0xf1]),
  };
}

/** Print self-test page: 1F 40 */
export function selfCheck(): PrintCommand {
  return { label: "self-check", data: Uint8Array.from([0x1f, 0x40]) };
}

/**
 * Build a bitmap command matching the P15 column-major format.
 *
 * Header: 1D 76 30 QQ  (height/8)L (height/8)H  widthL widthH
 * Data:   column-major, LSB = top pixel of each 8-row group,
 *         groups ordered bottom-to-top within each column
 *         (matches newprint_withfeed.py bitmap_to_packet exactly).
 */
export function printBitmap(
  image: ImageBitmap1bpp,
  quality: number = 0,
): PrintCommand {
  const { data: rowMajor, bytesPerRow, width, height } = image;
  const bytesPerCol = Math.ceil(height / 8);

  // Convert row-major MSB-first → column-major LSB-first (bottom group first)
  const colMajor = new Uint8Array(width * bytesPerCol);
  let idx = 0;
  for (let x = 0; x < width; x++) {
    // iterate y groups from bottom to top, matching Python's range(height-8, -1, -8)
    for (let yGroup = bytesPerCol - 1; yGroup >= 0; yGroup--) {
      const yBase = yGroup * 8;
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const py = yBase + bit;
        if (py < height) {
          const byteIdx = py * bytesPerRow + Math.floor(x / 8);
          const bitShift = 7 - (x % 8);
          if ((rowMajor[byteIdx] >> bitShift) & 1) {
            byte |= 1 << bit;
          }
        }
      }
      colMajor[idx++] = byte;
    }
  }

  // Header uses (height/8, width) — not (bytesPerRow, height)
  const header = Uint8Array.from([
    0x1d, 0x76, 0x30, quality & 0x03,
    bytesPerCol & 0xff, (bytesPerCol >> 8) & 0xff,
    width & 0xff, (width >> 8) & 0xff,
  ]);

  const command = new Uint8Array(header.length + colMajor.length);
  command.set(header, 0);
  command.set(colMajor, header.length);

  return { label: "print-bitmap", data: command, bulk: true };
}
