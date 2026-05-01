import type {
  CommandChatContext,
  CommandContext,
  CommandTuiSessionContext,
} from "../agent/types.js";
import { classifyCommand } from "../runtime/command-registry.js";
import { parseCommandLine, type CommandRunOutput } from "../runtime/command-runner.js";
import { getGitCommandStats } from "../runtime/git-command-stats.js";
import {
  formatTuiSessionLarkSummary,
  formatTuiSessionGitSummary,
  type TuiSessionInfo,
} from "../runtime/tui-session.js";
export function shouldTriggerBeforeRunOnTab({
  input,
  isRunning,
}: {
  input: string;
  completionSuffix?: string | undefined;
  isRunning: boolean;
}) {
  const parsed = parseCommandLine(input);
  const classification = parsed ? classifyCommand(parsed) : undefined;
  return Boolean(
    parsed &&
      !isRunning &&
      classification?.kind === "git" &&
      input.trim().length > 0,
  );
}

export function buildBeforeRunContext(
  input: string,
  cwd: string = process.cwd(),
  session?: TuiSessionInfo | undefined,
): Promise<CommandContext | undefined> {
  const parsed = parseCommandLine(input);
  const classification = parsed ? classifyCommand(parsed) : undefined;
  if (!parsed || classification?.kind !== "git") {
    return Promise.resolve(undefined);
  }

  const rawCommand = [parsed.command, ...parsed.args].join(" ");
  return getGitCommandStats(cwd, rawCommand).then((stats) => ({
    cwd,
    command: parsed.command,
    args: parsed.args,
    rawCommand,
    gitStats: {
      successCount: stats?.successCount ?? 0,
      failures: stats?.failures ?? [],
    },
    ...(session ? { tuiSession: buildCommandTuiSessionContext(session) } : {}),
  }));
}

export type ParsedChatCommand = {
  rawCommand: string;
  message: string;
};

export function parseChatCommand(input: string): ParsedChatCommand | undefined {
  const rawCommand = input.trim();
  if (!isChatCommandInput(rawCommand)) {
    return undefined;
  }

  const message = rawCommand.slice("/chat".length).trim();
  if (!message) {
    return undefined;
  }

  return {
    rawCommand,
    message,
  };
}

export function isChatCommandInput(input: string): boolean {
  return /^\/chat(?:\s|$)/.test(input.trim());
}

export function buildChatCommandContext({
  input,
  cwd = process.cwd(),
  session,
}: {
  input: string;
  cwd?: string | undefined;
  session?: TuiSessionInfo | undefined;
}): CommandChatContext | undefined {
  const parsed = parseChatCommand(input);
  if (!parsed) {
    return undefined;
  }

  return {
    cwd,
    command: "/chat",
    args: [parsed.message],
    rawCommand: parsed.rawCommand,
    message: parsed.message,
    ...(session ? { tuiSession: buildCommandTuiSessionContext(session) } : {}),
  };
}

function buildCommandTuiSessionContext(session: TuiSessionInfo): CommandTuiSessionContext {
  const header = getSessionHeaderParts(session);
  return {
    cwd: session.cwd,
    git: session.git,
    lark: session.lark,
    header,
  };
}

export function shouldIgnoreTabAgentTrigger({
  input,
  lastTriggeredInput,
  isAgentBusy,
}: {
  input: string;
  lastTriggeredInput?: string | undefined;
  isAgentBusy: boolean;
}) {
  const commandLine = input.trim();
  return Boolean(isAgentBusy || (commandLine && commandLine === lastTriggeredInput));
}

export function getSessionHeaderParts(session: TuiSessionInfo | undefined) {
  return {
    cwd: session?.cwd ?? process.cwd(),
    gitSummary: session ? formatTuiSessionGitSummary(session.git) : "git: initializing",
    larkSummary: session ? formatTuiSessionLarkSummary(session.lark) : "lark: initializing",
  };
}

export function shouldRefreshSessionAfterCommand(result: CommandRunOutput) {
  return (
    result.kind === "execute" &&
    (Boolean(result.nextCwd) ||
      result.classification?.kind === "git" ||
      (result.classification?.kind === "custom" &&
        result.classification.name === "lark"))
  );
}
