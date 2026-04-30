import type { Writable } from "node:stream";
import { Command } from "commander";

import { createLarkAgent } from "../agent/lark-agent.js";
import type { CommandAgentOutput, LarkAgent } from "../agent/types.js";
import type { LarkCliOutputChunk } from "../integrations/types.js";
import { buildLarkProjectHints } from "../runtime/lark-project-hints.js";

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
      const cwd = process.cwd();
      const projectHints = await buildLarkProjectHints(cwd);
      await runAgentAndForward(
        () =>
          getLarkAgent(options).authorize({
            cwd,
            intent: "init",
            projectHints,
          }),
        options,
      );
    });

  return command;
}

async function runAgentAndForward(
  action: () => Promise<CommandAgentOutput>,
  options: LarkCommandOptions = {},
): Promise<void> {
  try {
    const output = await action();
    const message = output.content.trim();
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
  return (
    options.agent ??
    createLarkAgent({
      onLarkCliOutput: createLarkCliOutputForwarder(options),
    })
  );
}

export function createLarkCliOutputForwarder(options: LarkCommandOptions = {}) {
  return (chunk: LarkCliOutputChunk) => {
    const target = chunk.stream === "stdout" ? getStdout(options) : getStderr(options);
    target.write(chunk.text);
  };
}

function getStdout(options: LarkCommandOptions) {
  return options.stdout ?? process.stdout;
}

function getStderr(options: LarkCommandOptions) {
  return options.stderr ?? process.stderr;
}
