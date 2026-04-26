import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getGitCommandStats,
  getGitCommandStatsPath,
  loadGitCommandStats,
  normalizeGitCommand,
  recordGitCommandFailure,
  recordGitCommandSuccess,
  shouldSkipIdleHelp,
} from "../../src/runtime/git-command-stats.js";

async function createTempCwd() {
  return mkdtemp(join(tmpdir(), "git-helper-stats-"));
}

test("normalizeGitCommand stores git commands by subcommand only", () => {
  assert.equal(normalizeGitCommand("  git   status   ?  "), "git status");
  assert.equal(normalizeGitCommand("git status --short"), "git status");
  assert.equal(normalizeGitCommand("git commit -m test"), "git commit");
  assert.equal(normalizeGitCommand("git worktree list"), "git worktree");
  assert.equal(normalizeGitCommand("git daemon --verbose"), "git daemon");
  assert.equal(normalizeGitCommand("git"), "git help");
  assert.equal(normalizeGitCommand("node -v"), undefined);
});

test("recordGitCommandSuccess persists success counts", async () => {
  const cwd = await createTempCwd();
  const now = new Date("2026-04-25T12:00:00.000Z");

  await recordGitCommandSuccess(cwd, "git status", now);
  await recordGitCommandSuccess(cwd, " git  status --short ", now);

  assert.equal(getGitCommandStatsPath(cwd), join(cwd, ".git-helper", "command-stats.json"));
  assert.deepEqual(await loadGitCommandStats(cwd), {
    schemaVersion: 3,
    commands: {
      "git status": {
        command: "git status",
        successCount: 2,
        lastSuccessAt: "2026-04-25T12:00:00.000Z",
        failures: [],
        updatedAt: "2026-04-25T12:00:00.000Z",
      },
    },
  });
});

test("loadGitCommandStats returns empty stats for empty or malformed stats files", async () => {
  const emptyCwd = await createTempCwd();
  await mkdir(join(emptyCwd, ".git-helper"), { recursive: true });
  await writeFile(getGitCommandStatsPath(emptyCwd), "", "utf8");

  assert.deepEqual(await loadGitCommandStats(emptyCwd), {
    schemaVersion: 3,
    commands: {},
  });

  const malformedCwd = await createTempCwd();
  await mkdir(join(malformedCwd, ".git-helper"), { recursive: true });
  await writeFile(getGitCommandStatsPath(malformedCwd), "{", "utf8");

  assert.deepEqual(await loadGitCommandStats(malformedCwd), {
    schemaVersion: 3,
    commands: {},
  });
});

test("recordGitCommandFailure resets success count and stores the last three distinct failures", async () => {
  const cwd = await createTempCwd();

  await recordGitCommandSuccess(cwd, "git push", new Date("2026-04-25T12:00:00.000Z"));
  await recordGitCommandFailure(
    cwd,
    "git push --force",
    {
      exitCode: 128,
      stdout: "",
      stderr: "fatal: rejected",
    },
    new Date("2026-04-25T12:05:00.000Z"),
  );
  await recordGitCommandFailure(
    cwd,
    "git push --force",
    {
      exitCode: 128,
      stdout: "",
      stderr: "fatal: rejected",
    },
    new Date("2026-04-25T12:05:30.000Z"),
  );
  await recordGitCommandFailure(
    cwd,
    "git push origin main",
    {
      exitCode: 1,
      stdout: "",
      stderr: "remote rejected",
    },
    new Date("2026-04-25T12:06:00.000Z"),
  );
  await recordGitCommandFailure(
    cwd,
    "git push --tags",
    {
      exitCode: 2,
      stdout: "pushing tags",
      stderr: "tag rejected",
    },
    new Date("2026-04-25T12:07:00.000Z"),
  );
  await recordGitCommandFailure(
    cwd,
    "git push --atomic",
    {
      exitCode: 3,
      stdout: "",
      stderr: "atomic push failed",
    },
    new Date("2026-04-25T12:08:00.000Z"),
  );

  assert.deepEqual(await getGitCommandStats(cwd, "git push --force"), {
    command: "git push",
    successCount: 0,
    lastSuccessAt: "2026-04-25T12:00:00.000Z",
    failures: [
      {
        count: 1,
        exitCode: 1,
        stdout: "",
        stderr: "remote rejected",
        occurredAt: "2026-04-25T12:06:00.000Z",
      },
      {
        count: 1,
        exitCode: 2,
        stdout: "pushing tags",
        stderr: "tag rejected",
        occurredAt: "2026-04-25T12:07:00.000Z",
      },
      {
        count: 1,
        exitCode: 3,
        stdout: "",
        stderr: "atomic push failed",
        occurredAt: "2026-04-25T12:08:00.000Z",
      },
    ],
    updatedAt: "2026-04-25T12:08:00.000Z",
  });
});

test("recordGitCommandFailure merges identical failures and updates count", async () => {
  const cwd = await createTempCwd();

  await recordGitCommandFailure(
    cwd,
    "git push --force",
    {
      exitCode: 128,
      stdout: "",
      stderr: "fatal: rejected",
    },
    new Date("2026-04-25T12:05:00.000Z"),
  );
  await recordGitCommandFailure(
    cwd,
    "git push origin main",
    {
      exitCode: 128,
      stdout: "",
      stderr: "fatal: rejected",
    },
    new Date("2026-04-25T12:06:00.000Z"),
  );

  assert.deepEqual(await getGitCommandStats(cwd, "git push"), {
    command: "git push",
    successCount: 0,
    lastSuccessAt: null,
    failures: [
      {
        count: 2,
        exitCode: 128,
        stdout: "",
        stderr: "fatal: rejected",
        occurredAt: "2026-04-25T12:06:00.000Z",
      },
    ],
    updatedAt: "2026-04-25T12:06:00.000Z",
  });
});

test("shouldSkipIdleHelp uses the persisted success threshold", async () => {
  const cwd = await createTempCwd();

  await recordGitCommandSuccess(cwd, "git status");
  await recordGitCommandSuccess(cwd, "git status");
  await recordGitCommandSuccess(cwd, "git status");

  assert.equal(await shouldSkipIdleHelp(cwd, "git status", 3), true);
  assert.equal(await shouldSkipIdleHelp(cwd, "git status", 4), false);
});
