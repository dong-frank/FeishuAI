#!/usr/bin/env node

import { loadProjectEnv } from "./runtime/project-root.js";

loadProjectEnv(import.meta.url);

const [{ Command }, { createLarkCommand }, { renderTui }] = await Promise.all([
  import("commander"),
  import("./commands/lark.js"),
  import("./tui/render.js"),
]);

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
