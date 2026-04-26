import { Writable } from "node:stream";

import { createLarkAgent } from "../agent/lark-agent.js";
import type { CommandAgent, CommandContext } from "../agent/types.js";
import type { LarkAgent } from "../agent/types.js";
import { classifyCommand, type CommandClassification } from "./command-registry.js";
import { executeCommand } from "./command-executor.js";
import {
  getGitCommandStats,
  loadGitCommandStats,
  normalizeGitCommand,
  recordGitCommandFailure,
  recordGitCommandSuccess,
} from "./git-command-stats.js";
import {
  initializeTuiSession,
  type TuiSessionGitInfo,
} from "./tui-session.js";

export type ParsedCommandLine = {
  command: string;
  args: string[];
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
    afterSuccessAgentKind?: "command" | "lark";
    afterFail?: Promise<string | void>;
    afterFailAgentKind?: "command";
  })
  | (BaseCommandRunOutput & {
      kind: "help";
      help: string;
    });

export type RunCommandLineOptions = {
  agent?: CommandAgent;
  larkAgent?: Pick<LarkAgent, "authorize">;
  statsCwd?: string;
  executeCommand?: typeof executeCommand;
  initializeSession?: typeof initializeTuiSession;
  onOutput?: (chunk: CommandOutputChunk) => void;
};

export type CommandOutputChunk = {
  stream: "stdout" | "stderr";
  text: string;
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
  const command = parts[0];
  if (!command) {
    return undefined;
  }

  return {
    command,
    args: parts.slice(1),
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

  const stdout = createCaptureStream((text) => {
    options.onOutput?.({ stream: "stdout", text });
  });
  const stderr = createCaptureStream((text) => {
    options.onOutput?.({ stream: "stderr", text });
  });
  const classification = classifyCommand(parsed);
  if (classification.kind === "custom" && classification.name === "lark") {
    return runLarkCustomCommand(commandLine, parsed, classification, options);
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
  let afterFail: Promise<string | void> | undefined;
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
        afterSuccess = Promise.resolve(
          buildGitRepositoryContext(options)
            .then((gitRepository) =>
              options.agent?.afterSuccess?.(
                {
                  ...context,
                  gitRepository,
                },
                result,
              ),
            ),
        );
      }
    } else {
      await recordGitCommandFailure(options.statsCwd ?? process.cwd(), rawCommand, result);
    }
  }
  if (exitCode !== 0 && options.agent?.afterFail) {
    afterFail = Promise.resolve(
      buildCommandContext(parsed, options.statsCwd ?? process.cwd()).then((context) =>
        options.agent?.afterFail?.(context, result),
      ),
    );
  }

  return {
    commandLine,
    kind: "execute",
    classification,
    exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(afterSuccess ? { afterSuccess } : {}),
    ...(afterSuccess ? { afterSuccessAgentKind: "command" as const } : {}),
    ...(afterFail ? { afterFail } : {}),
    ...(afterFail ? { afterFailAgentKind: "command" as const } : {}),
  };
}

async function runLarkCustomCommand(
  commandLine: string,
  parsed: ParsedCommandLine,
  classification: CommandClassification,
  options: RunCommandLineOptions,
): Promise<CommandRunOutput> {
  const subcommand = parsed.args[0];

  if (subcommand !== "init") {
    return {
      commandLine,
      kind: "execute",
      classification,
      exitCode: 1,
      stdout: "",
      stderr: `Unsupported lark command: ${subcommand ?? ""}\n`,
    };
  }

  try {
    const afterSuccess = getLarkAgent(options).authorize({
      cwd: process.cwd(),
      intent: "init",
    });

    return {
      commandLine,
      kind: "execute",
      classification,
      exitCode: 0,
      stdout: "Lark authorization agent started in background.\n",
      stderr: "",
      afterSuccess,
      afterSuccessAgentKind: "lark",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      commandLine,
      kind: "execute",
      classification,
      exitCode: 1,
      stdout: "",
      stderr: `${message}\n`,
    };
  }
}

function getLarkAgent(options: RunCommandLineOptions) {
  return options.larkAgent ?? createLarkAgent();
}

async function buildGitRepositoryContext(
  options: RunCommandLineOptions,
): Promise<TuiSessionGitInfo> {
  const initializeSession = options.initializeSession ?? initializeTuiSession;
  const session = await initializeSession({
    cwd: process.cwd(),
  });
  return session.git;
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

function createCaptureStream(onWrite?: (text: string) => void) {
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString();
      output += text;
      onWrite?.(text);
      callback();
    },
  });

  return {
    stream,
    output: () => output,
  };
}
