import assert from "node:assert/strict";
import test from "node:test";

import {
  formatTuiSessionGitSummary,
  initializeTuiSession,
  parseGitPorcelainStatus,
} from "../../src/runtime/tui-session.js";

test("initializeTuiSession records workspace and git repository information", async () => {
  const calls: string[][] = [];

  const session = await initializeTuiSession({
    cwd: "/repo/worktree",
    now: new Date("2026-04-25T12:00:00.000Z"),
    runGitCommand(args) {
      calls.push(args);
      const command = args.join(" ");
      if (command === "rev-parse --show-toplevel") {
        return Promise.resolve({ exitCode: 0, stdout: "/repo\n", stderr: "" });
      }
      if (command === "rev-parse --abbrev-ref HEAD") {
        return Promise.resolve({ exitCode: 0, stdout: "main\n", stderr: "" });
      }
      if (command === "rev-parse --short HEAD") {
        return Promise.resolve({ exitCode: 0, stdout: "abc1234\n", stderr: "" });
      }
      if (command === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
        return Promise.resolve({ exitCode: 0, stdout: "origin/main\n", stderr: "" });
      }
      if (command === "status --porcelain=v1") {
        return Promise.resolve({
          exitCode: 0,
          stdout: "M  staged.ts\n M unstaged.ts\n?? new.ts\n",
          stderr: "",
        });
      }

      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected command" });
    },
  });

  assert.deepEqual(calls, [
    ["rev-parse", "--show-toplevel"],
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["rev-parse", "--short", "HEAD"],
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    ["status", "--porcelain=v1"],
  ]);
  assert.deepEqual(session, {
    startedAt: "2026-04-25T12:00:00.000Z",
    cwd: "/repo/worktree",
    git: {
      isRepository: true,
      root: "/repo",
      branch: "main",
      head: "abc1234",
      upstream: "origin/main",
      status: {
        staged: 1,
        unstaged: 1,
        untracked: 1,
        dirty: true,
      },
    },
  });
});

test("initializeTuiSession records non-git workspaces without throwing", async () => {
  const session = await initializeTuiSession({
    cwd: "/tmp/no-repo",
    now: new Date("2026-04-25T12:00:00.000Z"),
    runGitCommand() {
      return Promise.resolve({
        exitCode: 128,
        stdout: "",
        stderr: "fatal: not a git repository",
      });
    },
  });

  assert.deepEqual(session, {
    startedAt: "2026-04-25T12:00:00.000Z",
    cwd: "/tmp/no-repo",
    git: {
      isRepository: false,
    },
  });
});

test("parseGitPorcelainStatus counts staged, unstaged, and untracked changes", () => {
  assert.deepEqual(
    parseGitPorcelainStatus("M  staged.ts\n M unstaged.ts\nAM both.ts\n?? new.ts\n"),
    {
      staged: 2,
      unstaged: 2,
      untracked: 1,
      dirty: true,
    },
  );
  assert.deepEqual(parseGitPorcelainStatus(""), {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    dirty: false,
  });
});

test("formatTuiSessionGitSummary keeps startup git info compact", () => {
  assert.equal(
    formatTuiSessionGitSummary({
      isRepository: true,
      root: "/repo",
      branch: "main",
      head: "abc1234",
      upstream: "origin/main",
      status: {
        staged: 1,
        unstaged: 2,
        untracked: 3,
        dirty: true,
      },
    }),
    "git: main abc1234 -> origin/main dirty S1 U2 ?3",
  );
  assert.equal(formatTuiSessionGitSummary({ isRepository: false }), "git: no repository");
});
