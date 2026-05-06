import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  getLarkInitStatePath,
  loadLarkInitState,
  recordLarkInitStarted,
  shouldAutoRunLarkInit,
} from "../../src/runtime/lark-init-state.js";

const execFileAsync = promisify(execFile);

async function createTempCwd() {
  return mkdtemp(join(tmpdir(), "gitx-lark-init-state-"));
}

test("/login state allows auto run when no recent start exists", async () => {
  const cwd = await createTempCwd();

  assert.equal(
    await shouldAutoRunLarkInit(cwd, new Date("2026-05-06T10:00:00.000Z")),
    true,
  );
});

test("/login state skips auto run inside the 12 hour cooldown", async () => {
  const cwd = await createTempCwd();
  await recordLarkInitStarted(cwd, new Date("2026-05-06T00:00:00.000Z"));

  assert.equal(
    await shouldAutoRunLarkInit(cwd, new Date("2026-05-06T11:59:59.000Z")),
    false,
  );
});

test("/login state allows auto run after the 12 hour cooldown", async () => {
  const cwd = await createTempCwd();
  await recordLarkInitStarted(cwd, new Date("2026-05-06T00:00:00.000Z"));

  assert.equal(
    await shouldAutoRunLarkInit(cwd, new Date("2026-05-06T12:00:00.000Z")),
    true,
  );
});

test("/login state treats empty malformed and incompatible files as empty", async () => {
  const cwd = await createTempCwd();
  await mkdir(join(cwd, ".gitx"), { recursive: true });
  const statePath = await getLarkInitStatePath(cwd);

  await writeFile(statePath, "", "utf8");
  assert.deepEqual(await loadLarkInitState(cwd), { lastStartedAt: null });

  await writeFile(statePath, "{", "utf8");
  assert.deepEqual(await loadLarkInitState(cwd), { lastStartedAt: null });

  await writeFile(statePath, JSON.stringify({ schemaVersion: 999 }), "utf8");
  assert.deepEqual(await loadLarkInitState(cwd), { lastStartedAt: null });
});

test("/login state is stored under the git root when available", async () => {
  const root = await createTempCwd();
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
  const gitRoot = await realpath(root);
  const nested = join(root, "packages", "cli");
  await mkdir(nested, { recursive: true });

  await recordLarkInitStarted(nested, new Date("2026-05-06T10:00:00.000Z"));

  assert.equal(await getLarkInitStatePath(nested), join(gitRoot, ".gitx", "lark-init-state.json"));
  assert.equal(
    JSON.parse(await readFile(join(root, ".gitx", "lark-init-state.json"), "utf8"))
      .lastStartedAt,
    "2026-05-06T10:00:00.000Z",
  );
});
