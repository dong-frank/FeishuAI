import type { Writable } from "node:stream";
import { Command } from "commander";

import { createLarkAgent } from "../agent/lark-agent.js";
import type { LarkAgent } from "../agent/types.js";

export type LarkCommandOptions = {
  agent?: Pick<LarkAgent, "authorize">;
  stdout?: Writable;
  stderr?: Writable;
};

export function createLarkCommand(options: LarkCommandOptions = {}): Command {
  const command = new Command("lark").description("Manage lark-cli authorization");

  command
    .command("init")
    .description("Run lark authorization agent phase")
    .action(async () => {
      await runAgentAndForward(
        () =>
          getLarkAgent(options).authorize({
            cwd: process.cwd(),
            intent: "init",
          }),
        options,
      );
    });

  return command;
}

async function runAgentAndForward(
  action: () => Promise<string>,
  options: LarkCommandOptions = {},
): Promise<void> {
  try {
    const message = await action();
    if (message) {
      getStdout(options).write(`${message}\n`);
    }
    process.exitCode = 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getStderr(options).write(`${message}\n`);
    process.exitCode = 1;
  }
}

function getLarkAgent(options: LarkCommandOptions) {
  return options.agent ?? createLarkAgent();
}

function getStdout(options: LarkCommandOptions) {
  return options.stdout ?? process.stdout;
}

function getStderr(options: LarkCommandOptions) {
  return options.stderr ?? process.stderr;
}
