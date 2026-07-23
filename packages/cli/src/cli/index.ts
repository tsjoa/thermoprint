import { Command } from "commander";
import { registerDiscoverCommands } from "./commands/discover.js";
import { registerPrintCommands } from "./commands/print.js";
import { registerStatusCommands } from "./commands/status.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerPrintTemplateCommands } from "./commands/print-template.js";
import { registerServeCommands } from "./commands/serve.js";
import { registerLabelCommands } from "./commands/label.js";

export function createCLI(): Command {
  const program = new Command();

  program
    .name("thermoprint")
    .description("CLI for Bluetooth thermal printers")
    .version("0.1.0");

  registerDiscoverCommands(program);
  registerPrintCommands(program);
  registerStatusCommands(program);
  registerConfigCommands(program);
  registerPrintTemplateCommands(program);
  registerServeCommands(program);
  registerLabelCommands(program);

  return program;
}
