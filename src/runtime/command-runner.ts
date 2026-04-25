import { Writable } from "node:stream";

import type { CommandAgent } from "../agent/types.js";
import { executeCommand } from "../commands/run.js";
import { classifyCommand, type CommandClassification } from "./command-registry.js";

export type ParsedCommandLine = {
  command: string;
  args: string[];
  helpRequested?: boolean;
};

export type CommandRunOutput = {
  commandLine: string;
  kind: "execute" | "help";
  classification?: CommandClassification;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunCommandLineOptions = {
  agent?: CommandAgent;
};

export function parseCommandLine(commandLine: string): ParsedCommandLine | undefined {
  const parts = commandLine.trim().split(/\s+/).filter(Boolean);
  const helpRequested = parts.at(-1) === "?";
  if (helpRequested) {
    parts.pop();
  }

  const command = parts[0];
  if (!command) {
    return undefined;
  }

  return {
    command,
    args: parts.slice(1),
    ...(helpRequested ? { helpRequested } : {}),
  };
}

export async function runCommandLine(
  commandLine: string,
  options: RunCommandLineOptions = {},
): Promise<CommandRunOutput> {
  const parsed = parseCommandLine(commandLine);
  if (!parsed) {
    return {
      commandLine,
      kind: "execute",
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  }

  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const classification = classifyCommand(parsed);
  if (parsed.helpRequested) {
    const help = await options.agent?.askForHelp?.({
      cwd: process.cwd(),
      command: parsed.command,
      args: parsed.args,
      rawCommand: [parsed.command, ...parsed.args].join(" "),
    });

    return {
      commandLine,
      kind: "help",
      classification,
      exitCode: 0,
      stdout: help ?? "",
      stderr: "",
    };
  }

  const exitCode = await executeCommand(parsed.command, parsed.args, {
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  return {
    commandLine,
    kind: "execute",
    classification,
    exitCode,
    stdout: stdout.output(),
    stderr: stderr.output(),
  };
}

function createCaptureStream() {
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });

  return {
    stream,
    output: () => output,
  };
}
