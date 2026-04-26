import type { CommandContext } from "../agent/types.js";
import { classifyCommand } from "../runtime/command-registry.js";
import { parseCommandLine, type CommandRunOutput } from "../runtime/command-runner.js";
import { getGitCommandStats } from "../runtime/git-command-stats.js";
import {
  formatTuiSessionGitSummary,
  type TuiSessionInfo,
} from "../runtime/tui-session.js";
import { BEFORE_RUN_SUCCESS_SKIP_THRESHOLD } from "./constants.js";

export function shouldScheduleBeforeRun({
  input,
  completionSuffix,
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
      !parsed.helpRequested &&
      !completionSuffix &&
      !isRunning &&
      classification?.kind === "git" &&
      input.trim().length > 0,
  );
}

export function shouldScheduleCommitMessageGeneration({
  input,
  completionSuffix,
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
      !completionSuffix &&
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
  if (!parsed || parsed.helpRequested || classification?.kind !== "git") {
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

export function shouldTriggerBeforeRunForContext(context: CommandContext) {
  return (
    (context.gitStats?.successCount ?? 0) < BEFORE_RUN_SUCCESS_SKIP_THRESHOLD
  );
}

export function getSessionHeaderParts(session: TuiSessionInfo | undefined) {
  return {
    cwd: session?.cwd ?? process.cwd(),
    gitSummary: session ? formatTuiSessionGitSummary(session.git) : "git: initializing",
  };
}

export function shouldRefreshSessionAfterCommand(result: CommandRunOutput) {
  return result.kind === "execute" && result.classification?.kind === "git";
}
