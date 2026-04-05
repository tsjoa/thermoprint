import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { findDevice } from "@thermoprint/core";
import type { BlePeripheral } from "@thermoprint/core";
import { NobleBleTransport } from "../../transport/noble.js";
import { loadConfig } from "../../store/config.js";

export function registerDiscoverCommands(program: Command): void {
  program
    .command("discover")
    .description("Scan for nearby supported printers")
    .option("-t, --timeout <ms>", "scan duration in ms", "5000")
    .option("--all", "show all BLE devices, not just supported printers")
    .option("--json", "output as JSON")
    .action(async (opts) => {
      const config = loadConfig();
      const timeout = parseInt(opts.timeout) || config.timeout || 5000;
      const transport = new NobleBleTransport();

      const spinner = ora("Scanning for printers...").start();

      try {
        // Phase 1: scan for all devices
        const allDevices: BlePeripheral[] = [];
        const seen = new Set<string>();
        const handle = await transport.scan((p) => {
          if (seen.has(p.id)) return;
          seen.add(p.id);
          allDevices.push(p);
        });
        await new Promise((resolve) => setTimeout(resolve, timeout));
        await handle.stop();

        if (opts.all) {
          spinner.stop();
          if (allDevices.length === 0) {
            console.log(chalk.yellow("No BLE devices found."));
            process.exit(0);
          }
          console.log(chalk.bold(`\nFound ${allDevices.length} BLE device(s):\n`));
          for (const p of allDevices) {
            const model = findDevice(p)?.modelId;
            const modelStr = model ? chalk.green(` [${model}]`) : "";
            const name = p.name || chalk.dim("(no name)");
            const uuids = p.serviceUuids.length ? chalk.dim(` {${p.serviceUuids.join(",")}}`) : "";
            console.log(`  ${chalk.cyan(name)}${modelStr}${uuids}  ${chalk.dim(p.id)}  RSSI: ${p.rssi}`);
          }
          console.log();
          process.exit(0);
        }

        // Phase 2: match by name / advertised service UUID
        const matched: Array<{ peripheral: BlePeripheral; modelId: string }> = [];
        for (const p of allDevices) {
          const profile = findDevice(p);
          if (profile) matched.push({ peripheral: p, modelId: profile.modelId });
        }

        spinner.stop();

        if (matched.length === 0) {
          console.log(chalk.yellow("No supported printers found. Run with --all to see all BLE devices."));
          process.exit(0);
        }

        console.log(chalk.bold(`\nFound ${matched.length} printer(s):\n`));
        for (const { peripheral: p, modelId } of matched) {
          const name = p.name || chalk.dim("(no name)");
          console.log(`  ${chalk.green(name)}  ${chalk.dim(p.id)}  RSSI: ${p.rssi}  Model: ${modelId}`);
        }
        console.log();
        process.exit(0);
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });
}
