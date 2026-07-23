import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { generateQrLabelTemplate, formatLabelPreview } from "../../render/label-generator.js";
import { renderTemplate, renderTemplatePng } from "../../render/template-renderer.js";
import { loadImage, trimImage } from "../../image/load.js";
import { processImage, L11Protocol, type DitherMode } from "@thermoprint/core";
import { BluepyBleTransport } from "../../transport/bluepy.js";
import { loadConfig } from "../../store/config.js";

function promptQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

export function registerLabelCommands(program: Command): void {
  program
    .command("label")
    .description("Generate and print a text + QR code label")
    .argument("<text>", "Label text to print (use \\n for line breaks)")
    .option("-q, --qr <content>", "QR code content (defaults to label text)")
    .option("--no-qr", "disable QR code on label")
    .option("-a, --address <mac>", "target printer BLE MAC address")
    .option("-p, --printer <name>", "target printer name")
    .option("-o, --out <path>", "save generated JSON template to file")
    .option("--font-size <px>", "font size in px", "22")
    .option("--width-mm <mm>", "label width in mm", "40")
    .option("--height-mm <mm>", "label height in mm", "12")
    .option("-d, --density <1-3>", "print density")
    .option("--paper <type>", "paper type: gap or continuous")
    .option("--dither <mode>", "dithering: floyd-steinberg, threshold, none")
    .option("--threshold <0-255>", "binarization cutoff")
    .option("-b, --border", "print fine outline border around text box")
    .option("-i, --interactive", "pause and prompt to review/edit text before printing")
    .option("-y, --yes", "print immediately without confirmation prompt")
    .option("--save-image <path>", "save rendered PNG to file")
    .option("--dry-run", "generate/render only, do not print")
    .option("--json", "output generated template or result as JSON")
    .action(async (textArg: string, opts) => {
      const config = loadConfig();
      const printerAddress =
        opts.address ??
        config.defaultAddress ??
        process.env.THERMOPRINT_ADDRESS ??
        "03:0D:7A:D6:5E:B1";
      const widthMm = parseFloat(opts.widthMm) || 40;
      const heightMm = parseFloat(opts.heightMm) || 12;
      const fontSize = parseInt(opts.fontSize) || 22;

      let currentText = textArg;

      // Determine if we should run interactive edit/confirmation loop
      const shouldPrompt =
        !opts.json &&
        !opts.dryRun &&
        (opts.interactive || (process.stdin.isTTY && !opts.yes));

      if (shouldPrompt) {
        while (true) {
          console.log();
          console.log(formatLabelPreview(currentText, opts.qr !== false));
          console.log();

          const tempTemplate = generateQrLabelTemplate({
            text: currentText,
            qrContent: opts.qr,
            widthMm,
            heightMm,
            fontSize,
            showQr: opts.qr !== false,
            border: !!opts.border,
          });

          if (tempTemplate.warnings && tempTemplate.warnings.length > 0) {
            for (const w of tempTemplate.warnings) {
              console.warn(chalk.yellow(`⚠️  Warning: ${w}`));
            }
          }

          const answer = await promptQuestion(
            chalk.bold("Print label? [Y/e(dit)/n(o)]: "),
          );

          if (answer.toLowerCase() === "e" || answer.toLowerCase() === "edit") {
            const newText = await promptQuestion(
              chalk.bold("Enter new label text (use \\n for line breaks): "),
            );
            if (newText) {
              currentText = newText;
            }
            continue;
          } else if (
            answer.toLowerCase() === "n" ||
            answer.toLowerCase() === "no" ||
            answer.toLowerCase() === "q" ||
            answer.toLowerCase() === "cancel"
          ) {
            console.log(chalk.yellow("Print cancelled."));
            process.exit(0);
          } else {
            // Y / Enter -> proceed to print
            break;
          }
        }
      } else if (!opts.json) {
        console.log();
        console.log(formatLabelPreview(currentText, opts.qr !== false));
        console.log();
      }

      const template = generateQrLabelTemplate({
        text: currentText,
        qrContent: opts.qr,
        widthMm,
        heightMm,
        fontSize,
        showQr: opts.qr !== false,
        border: !!opts.border,
      });

      if (!shouldPrompt && template.warnings && template.warnings.length > 0 && !opts.json) {
        for (const w of template.warnings) {
          console.warn(chalk.yellow(`⚠️  Warning: ${w}`));
        }
      }

      if (opts.out) {
        const outPath = path.resolve(opts.out);
        fs.writeFileSync(outPath, JSON.stringify(template, null, 2));
        if (!opts.json) {
          console.log(chalk.green(`Saved template to ${outPath}`));
        }
      }

      const targetWidth = Math.round(widthMm * 8);
      const image = await renderTemplate(template, { printWidth: targetWidth });

      if (opts.saveImage) {
        const pngBuf = await renderTemplatePng(template);
        fs.writeFileSync(path.resolve(opts.saveImage), pngBuf);
        if (!opts.json) {
          console.log(chalk.green(`Saved image to ${opts.saveImage}`));
        }
      }

      if (opts.dryRun) {
        if (opts.json) {
          console.log(JSON.stringify(template, null, 2));
        } else {
          console.log(chalk.cyan(`Rendered label: ${image.width}×${image.height}px`));
        }
        process.exit(0);
      }

      if (!printerAddress) {
        if (opts.json) {
          console.log(JSON.stringify(template, null, 2));
        } else {
          console.log(chalk.yellow("No printer address (-a) provided. Outputting generated template:"));
          console.log(JSON.stringify(template, null, 2));
        }
        process.exit(0);
      }

      const spinner = opts.json ? null : ora(`Connecting to ${printerAddress}...`).start();

      try {
        const trimmedImage = await trimImage(image);
        const dither = (opts.dither ?? "floyd-steinberg") as DitherMode;
        const thresholdVal = opts.threshold ? parseInt(opts.threshold) : undefined;
        const bitmap = processImage(trimmedImage, { dither, threshold: thresholdVal });

        const transport = new BluepyBleTransport();
        const conn = await transport.connect({
          id: printerAddress,
          name: "",
          rssi: -100,
          serviceUuids: ["e7810a7173ae499d8c15faa9aef0c3f2"],
        });

        const svc = await conn.discoverService("0000ff00-0000-1000-8000-00805f9b34fb");
        if (!svc) throw new Error("Service ff00 not found");
        const tx = await svc.getCharacteristic("0000ff02-0000-1000-8000-00805f9b34fb");
        if (!tx) throw new Error("TX characteristic ff02 not found");

        const protocol = new L11Protocol();
        const paperType = (opts.paper ?? config.paperType ?? "gap") as "gap" | "continuous";
        const density = opts.density ? parseInt(opts.density) : config.density;
        const commands = protocol.buildPrintSequence(bitmap, { density, paperType });

        const totalLen = commands.reduce((s, c) => s + c.data.length, 0);
        const allBytes = new Uint8Array(totalLen);
        let off = 0;
        for (const cmd of commands) {
          allBytes.set(cmd.data, off);
          off += cmd.data.length;
        }

        if (spinner) spinner.text = "Printing...";
        const CHUNK = 96;
        for (let i = 0; i < allBytes.length; i += CHUNK) {
          const chunk = allBytes.subarray(i, Math.min(i + CHUNK, allBytes.length));
          await tx.write(chunk, true);
          await new Promise((r) => setTimeout(r, 30));
        }

        await conn.disconnect();

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
