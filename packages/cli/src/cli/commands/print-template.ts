import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import sharp from "sharp";
import {
  discover,
  discoverAll,
  Printer,
  findDeviceByName,
  processImage,
  L11Protocol,
} from "@thermoprint/core";
import type { BlePeripheral, PrintOptions, DitherMode } from "@thermoprint/core";
import { NobleBleTransport } from "../../transport/noble.js";
import { BluepyBleTransport } from "../../transport/bluepy.js";
import { renderTemplate, renderTemplatePng } from "../../render/template-renderer.js";
import { trimImage } from "../../image/load.js";
import { loadConfig } from "../../store/config.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function findPrinter(
  transport: NobleBleTransport,
  printerName: string | undefined,
  address: string | undefined,
  timeout: number,
): Promise<BlePeripheral> {
  if (address) {
    return transport.scanForAddress(address, timeout);
  }
  if (printerName) {
    const peripherals = await discoverAll(transport, { timeoutMs: timeout });
    const match = peripherals.find(
      (p) => p.name.toLowerCase() === printerName.toLowerCase(),
    );
    if (!match) {
      throw new Error(`Printer "${printerName}" not found`);
    }
    return match;
  }
  return discover(transport, { timeoutMs: timeout });
}

export function registerPrintTemplateCommands(program: Command): void {
  program
    .command("print-template")
    .description("Render and print a label from a JSON template")
    .argument("<file>", 'path to template JSON file, or "-" for stdin')
    .option("-p, --printer <name>", "target printer by name")
    .option("-a, --address <mac>", "connect directly by BLE address (e.g. 03:0D:7A:D6:5E:B1)")
    .option("-d, --density <1-3>", "print density")
    .option("--paper <type>", "paper type: gap or continuous")
    .option("--dither <mode>", "dithering: floyd-steinberg, threshold, none")
    .option("--threshold <0-255>", "binarization cutoff")
    .option("-w, --width <px>", "print head width in pixels")
    .option("-t, --timeout <ms>", "discovery timeout in ms", "5000")
    .option("--json", "output progress/result as JSON")
    .option("--save-image <path>", "save rendered PNG to file (for debugging)")
    .option("--dry-run", "render only, do not print")
    .action(async (rawFile: string, opts) => {
      const config = loadConfig();
      const timeout = parseInt(opts.timeout) || config.timeout || 5000;
      const printWidth = parseInt(opts.width) || config.width || 384;
      const printerName = opts.printer ?? config.defaultPrinter;
      const printerAddress = opts.address ?? config.defaultAddress;
      const spinner = opts.json ? null : ora("Reading template...").start();

      try {
        // Read template JSON
        let templateJson: string;
        if (rawFile === "-") {
          templateJson = await readStdin();
        } else {
          const filePath = path.resolve(rawFile);
          if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
          }
          templateJson = fs.readFileSync(filePath, "utf-8");
        }

        // Validate JSON parses
        JSON.parse(templateJson);

        if (spinner) spinner.text = "Rendering template...";

        // Save image if requested
        if (opts.saveImage) {
          const png = await renderTemplatePng(templateJson);
          const savePath = path.resolve(opts.saveImage);
          fs.writeFileSync(savePath, png);
          if (opts.json) {
            console.log(JSON.stringify({ savedImage: savePath }));
          } else if (spinner) {
            spinner.info(`Saved rendered PNG to ${savePath}`);
          }
        }

        // Render template to raw image data
        const image = await renderTemplate(templateJson, { printWidth });

        if (opts.dryRun) {
          if (opts.json) {
            console.log(
              JSON.stringify({
                status: "dry-run",
                width: image.width,
                height: image.height,
              }),
            );
          } else {
            // Stop any existing spinner before printing info
            spinner?.stop();
            console.log(
              chalk.cyan(
                `Dry run: rendered ${image.width}×${image.height}px image`,
              ),
            );
          }
          process.exit(0);
        }

        // Discover printer
        if (spinner) spinner.text = "Discovering printer...";

        const trimmedImage = await trimImage(image);
        const dither = (opts.dither ?? "floyd-steinberg") as DitherMode;
        const thresholdVal = opts.threshold ? parseInt(opts.threshold) : undefined;
        const bitmap = processImage(trimmedImage, { dither, threshold: thresholdVal });

        if (printerAddress) {
          // ---- Bluepy raw path: replicate newprint_withfeed.py exactly ----
          const transport = new BluepyBleTransport();
          if (spinner) spinner.text = "Connecting via bluepy...";
          const conn = await transport.connect({
            id: printerAddress,
            name: "",
            rssi: -100,
            serviceUuids: ["e7810a7173ae499d8c15faa9aef0c3f2"],
          });

          // Get TX characteristic (ff02)
          const svc = await conn.discoverService("0000ff00-0000-1000-8000-00805f9b34fb");
          if (!svc) throw new Error("Service ff00 not found");
          const tx = await svc.getCharacteristic("0000ff02-0000-1000-8000-00805f9b34fb");
          if (!tx) throw new Error("TX characteristic ff02 not found");

          // Build protocol commands — same sequence as Python
          const protocol = new L11Protocol();
          const paperType = (opts.paper ?? config.paperType ?? "gap") as "gap" | "continuous";
          const density = opts.density ? parseInt(opts.density) : config.density;
          const commands = protocol.buildPrintSequence(bitmap, { density, paperType });

          // Concatenate all command data
          const totalLen = commands.reduce((s, c) => s + c.data.length, 0);
          const allBytes = new Uint8Array(totalLen);
          let off = 0;
          for (const cmd of commands) {
            allBytes.set(cmd.data, off);
            off += cmd.data.length;
          }

          // Send in 96-byte chunks with 30ms delay, like Python
          if (spinner) spinner.text = "Printing...";
          const CHUNK = 96;
          for (let i = 0; i < allBytes.length; i += CHUNK) {
            const chunk = allBytes.subarray(i, Math.min(i + CHUNK, allBytes.length));
            await tx.write(chunk, true); // withoutResponse = true
            await new Promise((r) => setTimeout(r, 30));
            if (spinner) {
              const pct = Math.round(((i + chunk.length) / allBytes.length) * 100);
              spinner.text = `Printing... ${pct}%`;
            }
          }

          await conn.disconnect();
        } else {
          // ---- Noble/D-Bus path with flow control ----
          const transport = new NobleBleTransport();
          const peripheral = await findPrinter(transport, printerName, undefined, timeout);

          if (spinner) spinner.text = `Connecting to ${peripheral.name}...`;
          const printer = await Printer.connect(transport, peripheral);

          const printOpts: PrintOptions = {};
          if (opts.density) printOpts.density = parseInt(opts.density);
          else if (config.density) printOpts.density = config.density;
          if (opts.paper) printOpts.paperType = opts.paper;
          else if (config.paperType) printOpts.paperType = config.paperType;
          if (opts.dither) printOpts.dither = opts.dither as DitherMode;
          if (opts.threshold) printOpts.threshold = parseInt(opts.threshold);

          printer.on("progress", ({ bytesSent, totalBytes }) => {
            const pct = Math.round((bytesSent / totalBytes) * 100);
            if (spinner) spinner.text = `Printing... ${pct}%`;
          });

          if (spinner) spinner.text = "Printing...";
          await printer.print(image, printOpts);
          await printer.disconnect();
        }

        if (opts.json) {
          console.log(JSON.stringify({ status: "success" }));
        } else {
          spinner?.succeed(chalk.green("Print complete!"));
        }
        process.exit(0);
      } catch (err: any) {
        if (opts.json) {
          console.log(JSON.stringify({ error: err.message }));
        } else {
          spinner?.fail(chalk.red(err.message));
        }
        process.exit(1);
      }
    });
}
