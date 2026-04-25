import { Command } from "commander";

import {
  loginLarkCli,
  setupLarkCli,
  statusLarkCli,
  type LarkCliResult,
} from "../integrations/lark-cli.js";

export function createLarkCommand(): Command {
  const command = new Command("lark").description("Manage lark-cli setup and login");

  command
    .command("status")
    .description("Check lark-cli auth status")
    .action(async () => {
      await runAndForward(statusLarkCli);
    });

  command
    .command("setup")
    .description("Configure lark-cli app credentials")
    .action(async () => {
      await runAndForward(setupLarkCli);
    });

  command
    .command("login")
    .description("Login to lark-cli with recommended scopes")
    .action(async () => {
      await runAndForward(loginLarkCli);
    });

  return command;
}

async function runAndForward(action: () => Promise<LarkCliResult>): Promise<void> {
  try {
    const result = await action();
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
