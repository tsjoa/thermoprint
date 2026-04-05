#!/usr/bin/env bun
/**
 * Minimal test: replicate newprint_withfeed.py exactly in TypeScript.
 * Usage: bun test-print.ts [text]
 */
import sharp from "sharp";
import { BluepyBleTransport } from "./src/transport/bluepy.ts";

const ADDRESS = "03:0D:7A:D6:5E:B1";
const CANVAS_HEIGHT = 96;
const text = process.argv[2] || "1234";
const saveImagePath = process.argv[3]; // optional: path to save PNG

// 1. Render text to 1-bit image (like Python's construct_bitmap)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${CANVAS_HEIGHT}">
  <rect width="400" height="${CANVAS_HEIGHT}" fill="white"/>
  <text x="2" y="${CANVAS_HEIGHT / 2}" dominant-baseline="middle" font-size="72" font-family="sans-serif" fill="black">${text}</text>
</svg>`;

const { data: rawBuf, info } = await sharp(Buffer.from(svg))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const canvasWidth = info.width;
const canvasHeight = info.height;
// Ensure height is multiple of 8
const paddedHeight = Math.ceil(canvasHeight / 8) * 8;

console.log(`Image: ${canvasWidth} x ${canvasHeight} (padded to ${paddedHeight})`);

// 2. bitmap_to_packet: column-major, bottom-to-top groups (exact Python logic)
const bytesPerCol = paddedHeight / 8;
const payload: number[] = [];
for (let x = 0; x < canvasWidth; x++) {
  for (let yByteGroup = paddedHeight - 8; yByteGroup >= 0; yByteGroup -= 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      const py = yByteGroup + bit;
      if (py < canvasHeight) {
        const idx = (py * canvasWidth + x) * 4; // RGBA
        const gray = (rawBuf[idx] + rawBuf[idx + 1] + rawBuf[idx + 2]) / 3;
        if (gray < 128) {
          byte |= (1 << bit);  // black pixel = set bit
        }
      }
    }
    payload.push(byte);
  }
}

console.log(`Payload: ${payload.length} bytes (${canvasWidth} x ${bytesPerCol})`);

// Save PNG if requested
if (saveImagePath) {
  await sharp(Buffer.from(rawBuf), { raw: { width: canvasWidth, height: canvasHeight, channels: 4 } })
    .png()
    .toFile(saveImagePath);
  console.log(`Saved image to ${saveImagePath}`);
  process.exit(0);
}

// 3. Build packets exactly like Python
const packets: Uint8Array[] = [
  // Packet 1: status query
  Uint8Array.from([0x10, 0xff, 0x40]),
  // Packet 2: wakeup + enable + bitmap header
  Uint8Array.from([
    ...new Array(15).fill(0x00),
    0x10, 0xff, 0xf1, 0x02,
    0x1d, 0x76, 0x30, 0x00,
    bytesPerCol & 0xff, (bytesPerCol >> 8) & 0xff,
    canvasWidth & 0xff, (canvasWidth >> 8) & 0xff,
  ]),
  // Packet 3: bitmap payload
  Uint8Array.from(payload),
  // Packet 4: line feeds
  Uint8Array.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a]),
  // Packet 5: stop
  Uint8Array.from([0x10, 0xff, 0xf1, 0x45]),
];

// 4. Connect via bluepy
console.log("Connecting...");
const transport = new BluepyBleTransport();
const conn = await transport.connect({
  id: ADDRESS, name: "", rssi: -100,
  serviceUuids: ["e7810a7173ae499d8c15faa9aef0c3f2"],
});
const svc = await conn.discoverService("0000ff00-0000-1000-8000-00805f9b34fb");
const tx = await svc!.getCharacteristic("0000ff02-0000-1000-8000-00805f9b34fb");

// 5. Send in 96-byte chunks with 30ms delay (exactly like Python)
console.log("Sending...");
for (const packet of packets) {
  for (let i = 0; i < packet.length; i += 96) {
    const chunk = packet.subarray(i, Math.min(i + 96, packet.length));
    await tx!.write(chunk, true);  // withoutResponse
    await new Promise(r => setTimeout(r, 30));
  }
}

console.log("Done! Disconnecting...");
await conn.disconnect();
process.exit(0);
