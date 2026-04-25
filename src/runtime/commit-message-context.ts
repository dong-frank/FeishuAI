import { execFile } from "node:child_process";

import type { CommitMessageContext } from "../agent/types.js";

type GitCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type GitCommandRunner = (
  args: string[],
  cwd: string,
) => Promise<GitCommandResult>;

type BuildCommitMessageContextOptions = {
  cwd?: string | undefined;
  runGitCommand?: GitCommandRunner | undefined;
};

export async function buildCommitMessageContext(
  options: BuildCommitMessageContextOptions = {},
): Promise<CommitMessageContext> {
  const cwd = options.cwd ?? process.cwd();
  const runGitCommand = options.runGitCommand ?? runGit;
  const [status, stagedDiff, unstagedDiff, recentCommits] = await Promise.all([
    runGitCommand(["status", "--short"], cwd),
    runGitCommand(["diff", "--cached"], cwd),
    runGitCommand(["diff"], cwd),
    runGitCommand(["log", "-5", "--pretty=%s"], cwd),
  ]);

  return {
    cwd,
    ...(status.exitCode === 0 ? { status: status.stdout.trim() } : {}),
    ...(stagedDiff.exitCode === 0 ? { stagedDiff: stagedDiff.stdout.trim() } : {}),
    ...(unstagedDiff.exitCode === 0 ? { unstagedDiff: unstagedDiff.stdout.trim() } : {}),
    ...(recentCommits.exitCode === 0
      ? { recentCommits: recentCommits.stdout.split("\n").filter(Boolean) }
      : {}),
  };
}

export function quoteCommitMessageForShell(message: string) {
  return `"${message.replace(/(["\\$`])/g, "\\$1")}"`;
}

function runGit(args: string[], cwd: string): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: 1500,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: getExitCode(error),
          stdout,
          stderr,
        });
      },
    );
  });
}

function getExitCode(error: unknown) {
  if (!error) {
    return 0;
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "number") {
      return code;
    }
  }

  return 1;
}
