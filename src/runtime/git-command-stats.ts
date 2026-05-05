import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CommandResult } from "../agent/types.js";

export type GitCommandFailure = {
  count: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  occurredAt: string;
};

export type GitCommandStatsEntry = {
  command: string;
  successCount: number;
  lastSuccessAt: string | null;
  failures: GitCommandFailure[];
  updatedAt: string;
};

export type GitCommandStats = {
  schemaVersion: 3;
  commands: Record<string, GitCommandStatsEntry>;
};

export const GIT_COMMAND_STATS_SCHEMA_VERSION = 3;
export const MAX_GIT_COMMAND_FAILURES = 3;
export const GITX_STATE_DIR = ".gitx";
export const GIT_COMMAND_STATS_FILE = "command-stats.json";

export function normalizeGitCommand(commandLine: string): string | undefined {
  const normalized = commandLine.trim().replace(/\s+/g, " ").replace(/\s+\?$/, "");
  const [command, subcommand] = normalized.split(" ");
  if (command !== "git") {
    return undefined;
  }

  if (!subcommand) {
    return "git help";
  }

  return `git ${subcommand}`;
}

export function getGitCommandStatsPath(cwd: string) {
  return join(cwd, GITX_STATE_DIR, GIT_COMMAND_STATS_FILE);
}

export async function loadGitCommandStats(cwd: string): Promise<GitCommandStats> {
  try {
    const content = await readFile(getGitCommandStatsPath(cwd), "utf8");
    if (!content.trim()) {
      return createEmptyGitCommandStats();
    }

    const parsed = JSON.parse(content) as Partial<GitCommandStats>;
    if (parsed.schemaVersion !== GIT_COMMAND_STATS_SCHEMA_VERSION || !parsed.commands) {
      return createEmptyGitCommandStats();
    }

    return {
      schemaVersion: GIT_COMMAND_STATS_SCHEMA_VERSION,
      commands: parsed.commands,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return createEmptyGitCommandStats();
    }

    if (error instanceof SyntaxError) {
      return createEmptyGitCommandStats();
    }

    throw error;
  }
}

export async function saveGitCommandStats(cwd: string, stats: GitCommandStats) {
  await mkdir(join(cwd, GITX_STATE_DIR), { recursive: true });
  const statsPath = getGitCommandStatsPath(cwd);
  const tempPath = `${statsPath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
  await rename(tempPath, statsPath);
}

export async function recordGitCommandSuccess(
  cwd: string,
  commandLine: string,
  now: Date = new Date(),
) {
  const command = normalizeGitCommand(commandLine);
  if (!command) {
    return;
  }

  const stats = await loadGitCommandStats(cwd);
  const timestamp = now.toISOString();
  const current = stats.commands[command];

  stats.commands[command] = {
    command,
    successCount: (current?.successCount ?? 0) + 1,
    lastSuccessAt: timestamp,
    failures: current?.failures ?? [],
    updatedAt: timestamp,
  };

  await saveGitCommandStats(cwd, stats);
}

export async function recordGitCommandFailure(
  cwd: string,
  commandLine: string,
  result: CommandResult,
  now: Date = new Date(),
) {
  const command = normalizeGitCommand(commandLine);
  if (!command) {
    return;
  }

  const stats = await loadGitCommandStats(cwd);
  const timestamp = now.toISOString();
  const current = stats.commands[command];
  const failure = {
    count: 1,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    occurredAt: timestamp,
  };

  stats.commands[command] = {
    command,
    successCount: 0,
    lastSuccessAt: current?.lastSuccessAt ?? null,
    failures: updateFailures(current?.failures ?? [], failure),
    updatedAt: timestamp,
  };

  await saveGitCommandStats(cwd, stats);
}

export async function getGitCommandStats(cwd: string, commandLine: string) {
  const command = normalizeGitCommand(commandLine);
  if (!command) {
    return undefined;
  }

  const stats = await loadGitCommandStats(cwd);
  return stats.commands[command];
}

export async function shouldSkipIdleHelp(
  cwd: string,
  commandLine: string,
  threshold: number,
) {
  const stats = await getGitCommandStats(cwd, commandLine);
  return (stats?.successCount ?? 0) >= threshold;
}

function createEmptyGitCommandStats(): GitCommandStats {
  return {
    schemaVersion: GIT_COMMAND_STATS_SCHEMA_VERSION,
    commands: {},
  };
}

function updateFailures(
  currentFailures: GitCommandFailure[],
  failure: GitCommandFailure,
) {
  const matchingFailure = currentFailures.find((current) =>
    isSameFailure(current, failure),
  );
  const failuresWithoutMatch = currentFailures.filter(
    (current) => !isSameFailure(current, failure),
  );
  const updatedFailure = matchingFailure
    ? {
        ...matchingFailure,
        count: matchingFailure.count + 1,
        occurredAt: failure.occurredAt,
      }
    : failure;

  return [...failuresWithoutMatch, updatedFailure].slice(-MAX_GIT_COMMAND_FAILURES);
}

function isSameFailure(left: GitCommandFailure, right: GitCommandFailure) {
  return (
    left.exitCode === right.exitCode &&
    left.stdout === right.stdout &&
    left.stderr === right.stderr
  );
}
