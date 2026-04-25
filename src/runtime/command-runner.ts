import { Writable } from "node:stream";

import type { CommandAgent, CommandContext } from "../agent/types.js";
import { executeCommand } from "../commands/run.js";
import { classifyCommand, type CommandClassification } from "./command-registry.js";
import {
  getGitCommandStats,
  loadGitCommandStats,
  normalizeGitCommand,
  recordGitCommandFailure,
  recordGitCommandSuccess,
} from "./git-command-stats.js";

export type ParsedCommandLine = {
  command: string;
  args: string[];
  helpRequested?: boolean;
  hasUnclosedQuote?: boolean;
};

type BaseCommandRunOutput = {
  commandLine: string;
  classification?: CommandClassification;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunOutput =
  | (BaseCommandRunOutput & {
      kind: "execute";
      afterSuccess?: Promise<string | void>;
    })
  | (BaseCommandRunOutput & {
      kind: "help";
      help: string;
    });

export type RunCommandLineOptions = {
  agent?: CommandAgent;
  statsCwd?: string;
  executeCommand?: typeof executeCommand;
};

export const AFTER_SUCCESS_KEY_GIT_SUBCOMMANDS = [
  "commit",
  "push",
  "pull",
  "merge",
  "rebase",
] as const;

const AFTER_SUCCESS_KEY_GIT_SUBCOMMAND_SET = new Set<string>(
  AFTER_SUCCESS_KEY_GIT_SUBCOMMANDS,
);

export function shouldTriggerAfterSuccess({
  classification,
  rawCommand,
}: {
  classification?: CommandClassification | undefined;
  rawCommand: string;
}) {
  if (classification?.kind !== "git") {
    return false;
  }

  if (!AFTER_SUCCESS_KEY_GIT_SUBCOMMAND_SET.has(classification.subcommand)) {
    return false;
  }

  if (!normalizeGitCommand(rawCommand)) {
    return false;
  }

  return true;
}

export async function getGitCommandSuccessStats(cwd: string = process.cwd()) {
  const stats = await loadGitCommandStats(cwd);
  return Object.fromEntries(
    Object.entries(stats.commands).map(([command, entry]) => [
      command,
      entry.successCount,
    ]),
  );
}

export function parseCommandLine(commandLine: string): ParsedCommandLine | undefined {
  const parts = splitCommandLine(commandLine);
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
    ...(hasUnclosedQuote(commandLine) ? { hasUnclosedQuote: true } : {}),
  };
}

function hasUnclosedQuote(commandLine: string) {
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const character of commandLine.trim()) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    }
  }

  return Boolean(quote);
}

function splitCommandLine(commandLine: string) {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const character of commandLine.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaped) {
    current += "\\";
  }

  if (current) {
    parts.push(current);
  }

  return parts;
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
    const help =
      classification.kind === "git"
        ? await options.agent?.askForHelp?.(
            await buildCommandContext(parsed, options.statsCwd ?? process.cwd()),
          )
        : undefined;

    return {
      commandLine,
      kind: "help",
      classification,
      exitCode: 0,
      help: help ?? "",
      stdout: "",
      stderr: "",
    };
  }

  const runCommand = options.executeCommand ?? executeCommand;
  const exitCode = await runCommand(parsed.command, parsed.args, {
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  const rawCommand = [parsed.command, ...parsed.args].join(" ");
  const result = {
    exitCode,
    stdout: stdout.output(),
    stderr: stderr.output(),
  };
  let afterSuccess: Promise<string | void> | undefined;
  if (classification.kind === "git") {
    if (exitCode === 0) {
      await recordGitCommandSuccess(options.statsCwd ?? process.cwd(), rawCommand);
      const context = await buildCommandContext(
        parsed,
        options.statsCwd ?? process.cwd(),
      );
      if (
        options.agent?.afterSuccess &&
        shouldTriggerAfterSuccess({
          classification,
          rawCommand,
        })
      ) {
        afterSuccess = Promise.resolve(options.agent.afterSuccess(context, result));
      }
    } else {
      await recordGitCommandFailure(options.statsCwd ?? process.cwd(), rawCommand, result);
    }
  }

  return {
    commandLine,
    kind: "execute",
    classification,
    exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(afterSuccess ? { afterSuccess } : {}),
  };
}

async function buildCommandContext(
  parsed: ParsedCommandLine,
  statsCwd: string,
): Promise<CommandContext> {
  const rawCommand = [parsed.command, ...parsed.args].join(" ");
  const stats = await getGitCommandStats(statsCwd, rawCommand);

  return {
    cwd: process.cwd(),
    command: parsed.command,
    args: parsed.args,
    rawCommand,
    gitStats: {
      successCount: stats?.successCount ?? 0,
      failures: stats?.failures ?? [],
    },
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
