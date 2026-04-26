import type { CommandContext } from "../agent/types.js";
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

export function shouldTriggerCommitMessageGenerationOnTab({
  input,
  isRunning,
}: {
  input: string;
  completionSuffix?: string | undefined;
  isRunning: boolean;
}) {
  const parsed = parseCommandLine(input);
  return Boolean(
    parsed &&
      !parsed.hasUnclosedQuote &&
      !isRunning &&
      parsed.command === "git" &&
      parsed.args.length === 2 &&
      parsed.args[0] === "commit" &&
      parsed.args[1] === "-m",
  );
}

export function buildBeforeRunContext(
  input: string,
  cwd: string = process.cwd(),
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
  }));
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
