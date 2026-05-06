import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { GITX_STATE_DIR } from "./git-command-stats.js";
import { resolveProjectStateRoot } from "./project-root.js";

export type LarkInitState = {
  lastStartedAt: string | null;
};

type LarkInitStateFile = {
  schemaVersion: 1;
  lastStartedAt: string | null;
};

export const LARK_INIT_STATE_SCHEMA_VERSION = 1;
export const LARK_INIT_STATE_FILE = "lark-init-state.json";
export const LARK_INIT_AUTO_RUN_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export async function getLarkInitStatePath(cwd: string) {
  const root = await resolveProjectStateRoot(cwd);
  return join(root, GITX_STATE_DIR, LARK_INIT_STATE_FILE);
}

export async function loadLarkInitState(cwd: string): Promise<LarkInitState> {
  try {
    const content = await readFile(await getLarkInitStatePath(cwd), "utf8");
    if (!content.trim()) {
      return createEmptyLarkInitState();
    }

    const parsed = JSON.parse(content) as Partial<LarkInitStateFile>;
    if (
      parsed.schemaVersion !== LARK_INIT_STATE_SCHEMA_VERSION ||
      !isValidLastStartedAt(parsed.lastStartedAt)
    ) {
      return createEmptyLarkInitState();
    }

    return {
      lastStartedAt: parsed.lastStartedAt,
    };
  } catch (error) {
    if (error instanceof SyntaxError || isMissingFileError(error)) {
      return createEmptyLarkInitState();
    }

    throw error;
  }
}

export async function recordLarkInitStarted(cwd: string, now = new Date()) {
  const statePath = await getLarkInitStatePath(cwd);
  await mkdir(dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.tmp`;
  const file: LarkInitStateFile = {
    schemaVersion: LARK_INIT_STATE_SCHEMA_VERSION,
    lastStartedAt: now.toISOString(),
  };
  await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(tempPath, statePath);
}

export async function shouldAutoRunLarkInit(
  cwd: string,
  now = new Date(),
  cooldownMs = LARK_INIT_AUTO_RUN_COOLDOWN_MS,
) {
  const state = await loadLarkInitState(cwd);
  if (!state.lastStartedAt) {
    return true;
  }

  const lastStartedAt = Date.parse(state.lastStartedAt);
  if (Number.isNaN(lastStartedAt)) {
    return true;
  }

  return now.getTime() - lastStartedAt >= cooldownMs;
}

function createEmptyLarkInitState(): LarkInitState {
  return {
    lastStartedAt: null,
  };
}

function isValidLastStartedAt(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isMissingFileError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
