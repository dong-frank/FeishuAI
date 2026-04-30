import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";

import type { LarkProjectHints } from "../agent/types.js";
import { normalizeGitRemoteWebUrl } from "./tui-session.js";

const execFileAsync = promisify(execFile);

export async function buildLarkProjectHints(cwd: string): Promise<LarkProjectHints> {
  const hints: LarkProjectHints = {
    cwdName: basename(cwd),
  };

  const gitRoot = await runGit(["rev-parse", "--show-toplevel"], cwd);
  if (!gitRoot) {
    return hints;
  }

  hints.gitRoot = await normalizePath(gitRoot);

  const [branch, remoteUrl] = await Promise.all([
    getGitBranch(cwd),
    runGit(["config", "--get", "remote.origin.url"], cwd),
  ]);
  if (branch && branch !== "HEAD") {
    hints.branch = branch;
  }
  if (remoteUrl) {
    hints.remoteUrl = remoteUrl;
    const webUrl = normalizeGitRemoteWebUrl(remoteUrl);
    if (webUrl) {
      hints.webUrl = webUrl;
    }
  }

  const repositoryName = deriveRepositoryName(hints.webUrl ?? remoteUrl ?? hints.gitRoot);
  if (repositoryName) {
    hints.repositoryName = repositoryName;
  }

  return hints;
}

async function getGitBranch(cwd: string) {
  const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (branch && branch !== "HEAD") {
    return branch;
  }

  return runGit(["symbolic-ref", "--short", "HEAD"], cwd);
}

async function runGit(args: string[], cwd: string) {
  try {
    const result = await execFileAsync("git", args, { cwd });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function normalizePath(path: string) {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function deriveRepositoryName(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\.git$/, "").replace(/\/+$/, "");
  const name = basename(normalized);
  return name || undefined;
}
