import * as http from "node:http";
import type { Command } from "commander";
import chalk from "chalk";
import sharp from "sharp";
import { BluepyBleTransport } from "../../transport/bluepy.js";
import { processImage, L11Protocol } from "@thermoprint/core";
import type { DitherMode, RawImageData } from "@thermoprint/core";

const CHUNK_SIZE = 96;
const CHUNK_DELAY_MS = 30;

/** Trim whitespace from RGBA image so we only send the content area to the printer. */
async function trimImage(image: RawImageData): Promise<RawImageData> {
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
}

async function printRaw(
  address: string,
  image: RawImageData,
  opts: { density?: number; paperType?: "gap" | "continuous"; dither?: DitherMode; threshold?: number },
) {
  // Trim whitespace so we send a compact image like newprint_withfeed.py does
  const trimmed = await trimImage(image);
  console.log(chalk.gray(`  Trimmed: ${image.width}x${image.height} -> ${trimmed.width}x${trimmed.height}`));

  const bitmap = processImage(trimmed, {
    dither: opts.dither ?? "floyd-steinberg",
    threshold: opts.threshold,
  });

  const protocol = new L11Protocol();
  const commands = protocol.buildPrintSequence(bitmap, {
    density: opts.density,
    paperType: opts.paperType ?? "gap",
  });

  const transport = new BluepyBleTransport();
  const conn = await transport.connect({
    id: address,
    name: "",
    rssi: -100,
    serviceUuids: ["e7810a7173ae499d8c15faa9aef0c3f2"],
  });

  const svc = await conn.discoverService("0000ff00-0000-1000-8000-00805f9b34fb");
  if (!svc) throw new Error("Service ff00 not found");
  const tx = await svc.getCharacteristic("0000ff02-0000-1000-8000-00805f9b34fb");
  if (!tx) throw new Error("TX characteristic ff02 not found");

  const totalLen = commands.reduce((s, c) => s + c.data.length, 0);
  const allBytes = new Uint8Array(totalLen);
  let off = 0;
  for (const cmd of commands) {
    allBytes.set(cmd.data, off);
    off += cmd.data.length;
  }

  for (let i = 0; i < allBytes.length; i += CHUNK_SIZE) {
    const chunk = allBytes.subarray(i, Math.min(i + CHUNK_SIZE, allBytes.length));
    await tx.write(chunk, true);
    await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
  }

  await conn.disconnect();
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

export function registerServeCommands(program: Command): void {
  program
    .command("serve")
    .description("Start a local print proxy server for the web UI")
    .option("-a, --address <mac>", "printer BLE address", "03:0D:7A:D6:5E:B1")
    .option("--port <port>", "server port", "7654")
    .action(async (opts) => {
      const address: string = opts.address;
      const port = parseInt(opts.port);
      let printing = false;

      const server = http.createServer(async (req, res) => {
        // CORS preflight
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          res.end();
          return;
        }

        const url = new URL(req.url ?? "/", `http://localhost:${port}`);

        if (url.pathname === "/status") {
          jsonResponse(res, 200, { status: "ready", address, printing });
          return;
        }

        if (url.pathname === "/print" && req.method === "POST") {
          if (printing) {
            jsonResponse(res, 409, { error: "Already printing" });
            return;
          }

          try {
            printing = true;
            const body = JSON.parse(await readBody(req));
            const { width, height, data: pixelArray, settings } = body as {
              width: number;
              height: number;
              data: number[];
              settings?: {
                density?: number;
                paperType?: "gap" | "continuous";
                ditherMode?: DitherMode;
                threshold?: number;
              };
            };

            const image: RawImageData = {
              data: new Uint8Array(pixelArray),
              width,
              height,
            };

            console.log(chalk.cyan(`Print job: ${width}x${height}px`));

            await printRaw(address, image, {
              density: settings?.density,
              paperType: settings?.paperType,
              dither: settings?.ditherMode,
              threshold: settings?.threshold,
            });

            console.log(chalk.green("Print complete"));
            jsonResponse(res, 200, { status: "success" });
          } catch (err: any) {
            console.error(chalk.red("Print failed:"), err.message);
            jsonResponse(res, 500, { error: err.message });
          } finally {
            printing = false;
          }
          return;
        }

        jsonResponse(res, 404, { error: "Not found" });
      });

      server.listen(port, () => {
        console.log(
          chalk.green(`Print proxy running at http://localhost:${port}`),
        );
        console.log(chalk.gray(`Printer address: ${address}`));
        console.log(chalk.gray("Endpoints:"));
        console.log(chalk.gray("  GET  /status  — server status"));
        console.log(chalk.gray("  POST /print   — send print job"));
      });
    });
}
