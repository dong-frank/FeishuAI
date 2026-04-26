import { execFile } from "node:child_process";

export type GitPorcelainStatus = {
  staged: number;
  unstaged: number;
  untracked: number;
  dirty: boolean;
};

export type GitBranchInfo = {
  local: string[];
  remote: string[];
};

export type GitRemoteInfo = {
  name: string;
  fetchUrl?: string | undefined;
  pushUrl?: string | undefined;
  webUrl?: string | undefined;
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
      branches: GitBranchInfo;
      remotes: GitRemoteInfo[];
    };

export type TuiSessionLarkInfo =
  | {
      isInstalled: false;
    }
  | {
      isInstalled: true;
      isConnected: false;
    }
  | {
      isInstalled: true;
      isConnected: true;
      identity?: string | undefined;
      name?: string | undefined;
    };

export type TuiSessionInfo = {
  startedAt: string;
  cwd: string;
  git: TuiSessionGitInfo;
  lark: TuiSessionLarkInfo;
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

type LarkCommandRunner = (
  args: string[],
  cwd: string,
) => Promise<GitCommandResult>;

type InitializeTuiSessionOptions = {
  cwd?: string | undefined;
  now?: Date | undefined;
  runGitCommand?: GitCommandRunner | undefined;
  runLarkCommand?: LarkCommandRunner | undefined;
};

const GIT_CONTEXT_BRANCH_LIMIT = 50;

export async function initializeTuiSession(
  options: InitializeTuiSessionOptions = {},
): Promise<TuiSessionInfo> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const runGitCommand = options.runGitCommand ?? runGit;
  const runLarkCommand = options.runLarkCommand ?? runLark;
  const larkPromise = getLarkInfo(runLarkCommand, cwd);

  const root = await runGitCommand(["rev-parse", "--show-toplevel"], cwd);
  if (root.exitCode !== 0) {
    return {
      startedAt: now.toISOString(),
      cwd,
      git: {
        isRepository: false,
      },
      lark: await larkPromise,
    };
  }

  const [branch, head, upstream, status, localBranches, remoteBranches, remotes] = await Promise.all([
    runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    runGitCommand(["rev-parse", "--short", "HEAD"], cwd),
    runGitCommand(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd),
    runGitCommand(["status", "--porcelain=v1"], cwd),
    runGitCommand(["branch", "--format=%(refname:short)"], cwd),
    runGitCommand(["branch", "-r", "--format=%(refname:short)"], cwd),
    runGitCommand(["remote", "-v"], cwd),
  ]);

  const git: TuiSessionGitInfo = {
    isRepository: true,
    root: root.stdout.trim(),
    ...(branch.exitCode === 0 ? { branch: branch.stdout.trim() } : {}),
    ...(head.exitCode === 0 ? { head: head.stdout.trim() } : {}),
    ...(upstream.exitCode === 0 ? { upstream: upstream.stdout.trim() } : {}),
    status: parseGitPorcelainStatus(status.exitCode === 0 ? status.stdout : ""),
    branches: {
      local: parseGitBranchList(localBranches.exitCode === 0 ? localBranches.stdout : ""),
      remote: parseGitRemoteBranchList(remoteBranches.exitCode === 0 ? remoteBranches.stdout : ""),
    },
    remotes: parseGitRemoteVerbose(remotes.exitCode === 0 ? remotes.stdout : ""),
  };

  return {
    startedAt: now.toISOString(),
    cwd,
    git,
    lark: await larkPromise,
  };
}

function parseGitBranchList(output: string) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, GIT_CONTEXT_BRANCH_LIMIT);
}

function parseGitRemoteBranchList(output: string) {
  return parseGitBranchList(output)
    .filter((branch) => !branch.endsWith("/HEAD") && !branch.includes(" -> "))
    .slice(0, GIT_CONTEXT_BRANCH_LIMIT);
}

function parseGitRemoteVerbose(output: string): GitRemoteInfo[] {
  const remoteByName = new Map<string, GitRemoteInfo>();
  const linePattern = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/;

  for (const line of output.split("\n")) {
    const match = line.trim().match(linePattern);
    if (!match) {
      continue;
    }

    const [, name, url, direction] = match;
    if (!name || !url) {
      continue;
    }

    const remote = remoteByName.get(name) ?? { name };
    if (direction === "fetch") {
      remote.fetchUrl = url;
    } else {
      remote.pushUrl = url;
    }

    const webUrl = normalizeGitRemoteWebUrl(remote.fetchUrl ?? remote.pushUrl);
    if (webUrl) {
      remote.webUrl = webUrl;
    }
    remoteByName.set(name, remote);
  }

  return [...remoteByName.values()];
}

export function normalizeGitRemoteWebUrl(url: string | undefined) {
  if (!url) {
    return undefined;
  }

  const trimmed = url.trim();
  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    return formatGitWebUrl(sshMatch[1], sshMatch[2]);
  }

  const sshUrlMatch = trimmed.match(/^ssh:\/\/(?:git@)?([^/]+)\/(.+)$/);
  if (sshUrlMatch) {
    return formatGitWebUrl(sshUrlMatch[1], sshUrlMatch[2]);
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }

    return formatGitWebUrl(parsed.host, parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return undefined;
  }
}

function formatGitWebUrl(host: string | undefined, path: string | undefined) {
  if (!host || !path) {
    return undefined;
  }

  const normalizedPath = path.replace(/\.git$/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalizedPath) {
    return undefined;
  }

  return `https://${host}/${normalizedPath}`;
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

export function formatTuiSessionLarkSummary(lark: TuiSessionLarkInfo) {
  if (!lark.isInstalled) {
    return "lark: not installed";
  }

  if (!lark.isConnected) {
    return "lark: not logged in";
  }

  const identity = [lark.identity, lark.name].filter(Boolean).join(" ");
  return `lark: connected${identity ? ` ${identity}` : ""}`;
}

async function getLarkInfo(
  runLarkCommand: LarkCommandRunner,
  cwd: string,
): Promise<TuiSessionLarkInfo> {
  try {
    const result = await runLarkCommand(["auth", "status"], cwd);
    if (result.exitCode !== 0) {
      return {
        isInstalled: true,
        isConnected: false,
      };
    }

    const status = parseLarkAuthStatus(result.stdout);
    if (!status.isConnected) {
      return {
        isInstalled: true,
        isConnected: false,
      };
    }

    return {
      isInstalled: true,
      isConnected: true,
      ...(status.identity ? { identity: status.identity } : {}),
      ...(status.name ? { name: status.name } : {}),
    };
  } catch (error) {
    if (isCommandMissing(error)) {
      return {
        isInstalled: false,
      };
    }

    return {
      isInstalled: true,
      isConnected: false,
    };
  }
}

function parseLarkAuthStatus(output: string): {
  isConnected: boolean;
  identity?: string | undefined;
  name?: string | undefined;
} {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!isRecord(parsed)) {
      return { isConnected: false };
    }

    const user = isRecord(parsed.user) ? parsed.user : undefined;
    const tokenStatus = parsed.tokenStatus;
    const isConnected = typeof tokenStatus === "string"
      ? tokenStatus === "valid"
      : true;
    const name = getFirstString([
      parsed.userName,
      parsed.name,
      user?.name,
    ]);

    return {
      isConnected,
      ...(typeof parsed.identity === "string" ? { identity: parsed.identity } : {}),
      ...(name ? { name } : {}),
    };
  } catch {
    return { isConnected: false };
  }
}

function getFirstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
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

function runLark(args: string[], cwd: string): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "lark-cli",
      args,
      {
        cwd,
        timeout: 1500,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (isCommandMissing(error)) {
          reject(error);
          return;
        }

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

function isCommandMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
