#!/usr/bin/env node

import { Command } from "commander";

import { createLarkCommand } from "./commands/lark.js";
import { renderTui } from "./tui/render.js";

const program = new Command();

program
  .name("git-helper")
  .description("Diagnose Git errors and suggest fixes")
  .version("0.1.0");

program.addCommand(createLarkCommand());

if (process.argv.length <= 2) {
  renderTui();
} else {
  program.parse();
}
