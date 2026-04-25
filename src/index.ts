#!/usr/bin/env node

import { Command } from "commander";

import { createCommandAgent } from "./agent/command-agent.js";
import { executeCommand } from "./commands/run.js";

const program = new Command();

program
  .name("git-helper")
  .description("Diagnose Git errors and suggest fixes")
  .version("0.1.0");

program
  .command("diagnose")
  .description("Diagnose a Git error")
  .option("--cmd <cmd>", "Original command")
  .option("--stderr <text>", "Error output")
  .action((options) => {
    console.log("diagnose:", options);
  });

program
  .command("run")
  .description("Run a command and diagnose failure")
  .allowUnknownOption()
  .argument("<cmd>")
  .argument("[args...]")
  .action(async (cmd: string, args: string[]) => {
    try {
      const exitCode = await executeCommand(cmd, args, {
        agent: createCommandAgent(),
      });
      process.exitCode = exitCode;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to run command: ${message}`);
      process.exitCode = 1;
    }
  });

program.parse();
