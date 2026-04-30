import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Writable } from "node:stream";

import { createLarkAgent } from "../agent/lark-agent.js";
import type {
  AgentRunMetadata,
  CommandAgent,
  CommandAgentOutput,
  CommandContext,
  CommandTuiSessionContext,
} from "../agent/types.js";
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
import { buildLarkProjectHints } from "./lark-project-hints.js";
import {
  formatTuiSessionGitSummary,
  formatTuiSessionLarkSummary,
  initializeTuiSession,
  type TuiSessionInfo,
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
  durationMs?: number;
  nextCwd?: string;
};

export type CommandRunOutput =
  | (BaseCommandRunOutput & {
    kind: "execute";
    afterSuccess?: Promise<CommandAgentOutput | string | void>;
    afterSuccessAgentKind?: "command" | "lark";
    afterFail?: Promise<CommandAgentOutput | void>;
    afterFailAgentKind?: "command";
  })
  | (BaseCommandRunOutput & {
      kind: "help";
      help: string;
      agentKind?: "command" | "lark";
      agentMetadata?: AgentRunMetadata;
    });

export type RunCommandLineOptions = {
  agent?: CommandAgent;
  cwd?: string;
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
  const cwd = options.cwd ?? process.cwd();
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
  if (parsed.command === "cd") {
    return runCdCommand(commandLine, parsed, classification, cwd);
  }

  if (parsed.command === "git-helper" && parsed.args.length === 0) {
    return runBlockedNestedTuiCommand(commandLine, classification);
  }

  if (classification.kind === "custom" && classification.name === "lark") {
    return runLarkCustomCommand(commandLine, parsed, classification, cwd, options);
  }

  const runCommand = options.executeCommand ?? executeCommand;
  const startedAt = Date.now();
  const exitCode = await runCommand(parsed.command, parsed.args, {
    cwd,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  const durationMs = Date.now() - startedAt;
  const rawCommand = [parsed.command, ...parsed.args].join(" ");
  const result = {
    exitCode,
    stdout: stdout.output(),
    stderr: stderr.output(),
  };
  let afterSuccess: Promise<CommandAgentOutput | string | void> | undefined;
  let afterFail: Promise<CommandAgentOutput | void> | undefined;
  const statsCwd = options.statsCwd ?? cwd;
  const agent = options.agent;
  if (classification.kind === "git") {
    if (exitCode === 0) {
      await recordGitCommandSuccess(statsCwd, rawCommand);
      const context = await buildCommandContext(
        parsed,
        cwd,
        statsCwd,
      );
      if (
        agent?.afterSuccess &&
        shouldTriggerAfterSuccess({
          classification,
          rawCommand,
        })
      ) {
        afterSuccess = Promise.resolve(
          buildCommandTuiSessionContext(cwd, options)
            .then((tuiSession) =>
              agent.afterSuccess?.(
                {
                  ...context,
                  tuiSession,
                },
                result,
              ),
            ),
        );
      }
    } else {
      await recordGitCommandFailure(statsCwd, rawCommand, result);
    }
  }
  if (exitCode !== 0 && agent?.afterFail) {
    afterFail = Promise.resolve(
      buildCommandContext(parsed, cwd, statsCwd).then((context) =>
        agent.afterFail?.(context, result),
      ),
    );
  }

  return {
    commandLine,
    kind: "execute",
    classification,
    exitCode,
    durationMs,
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
  cwd: string,
  options: RunCommandLineOptions,
): Promise<CommandRunOutput> {
  const subcommand = parsed.args[0];
  const startedAt = Date.now();

  if (subcommand !== "init") {
    return {
      commandLine,
      kind: "execute",
      classification,
      exitCode: 1,
      durationMs: Date.now() - startedAt,
      stdout: "",
      stderr: `Unsupported lark command: ${subcommand ?? ""}\n`,
    };
  }

  try {
    const afterSuccess = getLarkAgent(options).authorize({
      cwd,
      intent: "init",
      projectHints: await buildLarkProjectHints(cwd),
    });

    return {
      commandLine,
      kind: "execute",
      classification,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
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
      durationMs: Date.now() - startedAt,
      stdout: "",
      stderr: `${message}\n`,
    };
  }
}

async function runCdCommand(
  commandLine: string,
  parsed: ParsedCommandLine,
  classification: CommandClassification,
  cwd: string,
): Promise<CommandRunOutput> {
  const startedAt = Date.now();
  const target = parsed.args[0] ?? "~";
  if (target === "-") {
    return {
      commandLine,
      kind: "execute",
      classification,
      exitCode: 1,
      durationMs: Date.now() - startedAt,
      stdout: "",
      stderr: "cd: OLDPWD is not supported in git-helper TUI\n",
    };
  }

  const nextCwd = resolveCdTarget(cwd, target);
  try {
    const targetStat = await stat(nextCwd);
    if (!targetStat.isDirectory()) {
      return {
        commandLine,
        kind: "execute",
        classification,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        stdout: "",
        stderr: `cd: not a directory: ${target}\n`,
      };
    }

    return {
      commandLine,
      kind: "execute",
      classification,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      stdout: "",
      stderr: "",
      nextCwd,
    };
  } catch {
    return {
      commandLine,
      kind: "execute",
      classification,
      exitCode: 1,
      durationMs: Date.now() - startedAt,
      stdout: "",
      stderr: `cd: no such file or directory: ${target}\n`,
    };
  }
}

function resolveCdTarget(cwd: string, target: string) {
  if (target === "~") {
    return homedir();
  }

  if (target.startsWith("~/")) {
    return resolve(homedir(), target.slice(2));
  }

  return resolve(cwd, target);
}

function runBlockedNestedTuiCommand(
  commandLine: string,
  classification: CommandClassification,
): CommandRunOutput {
  const startedAt = Date.now();
  return {
    commandLine,
    kind: "execute",
    classification,
    exitCode: 1,
    durationMs: Date.now() - startedAt,
    stdout: "",
    stderr: "git-helper: cannot start git-helper inside git-helper TUI\n",
  };
}

function getLarkAgent(options: RunCommandLineOptions) {
  return options.larkAgent ?? createLarkAgent();
}

async function buildCommandTuiSessionContext(
  cwd: string,
  options: RunCommandLineOptions,
): Promise<CommandTuiSessionContext> {
  const initializeSession = options.initializeSession ?? initializeTuiSession;
  const session = await initializeSession({
    cwd,
  });
  return formatCommandTuiSessionContext(session);
}

function formatCommandTuiSessionContext(
  session: TuiSessionInfo,
): CommandTuiSessionContext {
  return {
    cwd: session.cwd,
    git: session.git,
    lark: session.lark,
    header: {
      cwd: session.cwd,
      gitSummary: formatTuiSessionGitSummary(session.git),
      larkSummary: formatTuiSessionLarkSummary(session.lark),
    },
  };
}

async function buildCommandContext(
  parsed: ParsedCommandLine,
  cwd: string,
  statsCwd: string,
): Promise<CommandContext> {
  const rawCommand = [parsed.command, ...parsed.args].join(" ");
  const stats = await getGitCommandStats(statsCwd, rawCommand);

  return {
    cwd,
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
