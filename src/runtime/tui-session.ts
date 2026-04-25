import { execFile } from "node:child_process";

export type GitPorcelainStatus = {
  staged: number;
  unstaged: number;
  untracked: number;
  dirty: boolean;
};

export type TuiSessionGitInfo =
  | {
      isRepository: false;
    }
  | {
      isRepository: true;
      root: string;
      branch?: string | undefined;
      head?: string | undefined;
      upstream?: string | undefined;
      status: GitPorcelainStatus;
    };

export type TuiSessionInfo = {
  startedAt: string;
  cwd: string;
  git: TuiSessionGitInfo;
};

type GitCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type GitCommandRunner = (
  args: string[],
  cwd: string,
) => Promise<GitCommandResult>;

type InitializeTuiSessionOptions = {
  cwd?: string | undefined;
  now?: Date | undefined;
  runGitCommand?: GitCommandRunner | undefined;
};

export async function initializeTuiSession(
  options: InitializeTuiSessionOptions = {},
): Promise<TuiSessionInfo> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const runGitCommand = options.runGitCommand ?? runGit;

  const root = await runGitCommand(["rev-parse", "--show-toplevel"], cwd);
  if (root.exitCode !== 0) {
    return {
      startedAt: now.toISOString(),
      cwd,
      git: {
        isRepository: false,
      },
    };
  }

  const [branch, head, upstream, status] = await Promise.all([
    runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    runGitCommand(["rev-parse", "--short", "HEAD"], cwd),
    runGitCommand(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd),
    runGitCommand(["status", "--porcelain=v1"], cwd),
  ]);

  const git: TuiSessionGitInfo = {
    isRepository: true,
    root: root.stdout.trim(),
    ...(branch.exitCode === 0 ? { branch: branch.stdout.trim() } : {}),
    ...(head.exitCode === 0 ? { head: head.stdout.trim() } : {}),
    ...(upstream.exitCode === 0 ? { upstream: upstream.stdout.trim() } : {}),
    status: parseGitPorcelainStatus(status.exitCode === 0 ? status.stdout : ""),
  };

  return {
    startedAt: now.toISOString(),
    cwd,
    git,
  };
}

export function parseGitPorcelainStatus(output: string): GitPorcelainStatus {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;

  for (const line of output.split("\n")) {
    if (!line) {
      continue;
    }

    const x = line.at(0) ?? " ";
    const y = line.at(1) ?? " ";
    if (x === "?" && y === "?") {
      untracked += 1;
      continue;
    }

    if (x !== " ") {
      staged += 1;
    }
    if (y !== " ") {
      unstaged += 1;
    }
  }

  return {
    staged,
    unstaged,
    untracked,
    dirty: staged + unstaged + untracked > 0,
  };
}

export function formatTuiSessionGitSummary(git: TuiSessionGitInfo) {
  if (!git.isRepository) {
    return "git: no repository";
  }

  const identity = [git.branch, git.head].filter(Boolean).join(" ") || "unknown";
  const upstream = git.upstream ? ` -> ${git.upstream}` : "";
  const dirty = git.status.dirty
    ? ` dirty S${git.status.staged} U${git.status.unstaged} ?${git.status.untracked}`
    : " clean";

  return `git: ${identity}${upstream}${dirty}`;
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
