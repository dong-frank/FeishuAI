import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getGitCommandSuccessStats,
  parseCommandLine,
  runCommandLine,
  shouldTriggerAfterSuccess,
} from "../../src/runtime/command-runner.js";
import {
  getGitCommandStats,
  recordGitCommandFailure,
  recordGitCommandSuccess,
} from "../../src/runtime/git-command-stats.js";

async function createTempCwd() {
  return mkdtemp(join(tmpdir(), "git-helper-runner-"));
}

test("parseCommandLine splits command and args", () => {
  assert.deepEqual(parseCommandLine("git status --short"), {
    command: "git",
    args: ["status", "--short"],
  });
});

test("parseCommandLine keeps quoted arguments together", () => {
  assert.deepEqual(parseCommandLine('git commit -m "增加lark agent"'), {
    command: "git",
    args: ["commit", "-m", "增加lark agent"],
  });
  assert.deepEqual(parseCommandLine("git commit -m '增加 lark agent'"), {
    command: "git",
    args: ["commit", "-m", "增加 lark agent"],
  });
});

test("parseCommandLine supports escaped quotes inside quoted arguments", () => {
  assert.deepEqual(parseCommandLine('git commit -m "say \\"hello\\""'), {
    command: "git",
    args: ["commit", "-m", 'say "hello"'],
  });
});

test("parseCommandLine marks unclosed quotes", () => {
  assert.deepEqual(parseCommandLine('git commit -m "'), {
    command: "git",
    args: ["commit", "-m"],
    hasUnclosedQuote: true,
  });
});

test("parseCommandLine returns undefined for blank input", () => {
  assert.equal(parseCommandLine("   "), undefined);
});

test("parseCommandLine marks trailing question mark as help request", () => {
  assert.deepEqual(parseCommandLine("git push ?"), {
    command: "git",
    args: ["push"],
    helpRequested: true,
  });
  assert.deepEqual(parseCommandLine('git commit -m "why ?"'), {
    command: "git",
    args: ["commit", "-m", "why ?"],
  });
});

test("runCommandLine calls askForHelp only for git help requests", async () => {
  const statsCwd = await createTempCwd();
  await recordGitCommandSuccess(statsCwd, "git status", new Date("2026-04-25T12:00:00.000Z"));
  await recordGitCommandFailure(
    statsCwd,
    "git status --bad",
    {
      exitCode: 129,
      stdout: "",
      stderr: "unknown option",
    },
    new Date("2026-04-25T12:05:00.000Z"),
  );
  const events: unknown[] = [];

  const result = await runCommandLine("git status ?", {
    statsCwd,
    agent: {
      askForHelp(context) {
        events.push(context.gitStats);
        return "use git status";
      },
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.kind, "help");
  assert.equal(result.help, "use git status");
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(events, [
    {
      successCount: 0,
      failures: [
        {
          count: 1,
          exitCode: 129,
          stdout: "",
          stderr: "unknown option",
          occurredAt: "2026-04-25T12:05:00.000Z",
        },
      ],
    },
  ]);
});

test("runCommandLine does not call askForHelp for non-git help requests", async () => {
  const events: string[] = [];

  const result = await runCommandLine("node -e process.exit(9) ?", {
    agent: {
      askForHelp(context) {
        events.push(`help:${context.rawCommand}`);
        return "use node --help";
      },
    },
  });

  assert.equal(result.kind, "help");
  assert.equal(result.help, "");
  assert.deepEqual(events, []);
});

test("runCommandLine records successful git command counts", async () => {
  const statsCwd = await createTempCwd();

  await runCommandLine("git status", { statsCwd });
  await runCommandLine("git status --short", { statsCwd });

  assert.deepEqual(await getGitCommandSuccessStats(statsCwd), {
    "git status": 2,
  });
});

test("runCommandLine records git failure and ignores non-git command counts", async () => {
  const statsCwd = await createTempCwd();

  await runCommandLine("git status --definitely-not-a-real-option", { statsCwd });
  await runCommandLine("node -e process.exit(0)", { statsCwd });

  assert.deepEqual(await getGitCommandSuccessStats(statsCwd), {
    "git status": 0,
  });
  const stats = await getGitCommandStats(statsCwd, "git status --definitely-not-a-real-option");
  assert.equal(stats?.failures.at(-1)?.exitCode, 129);
});

test("shouldTriggerAfterSuccess allows key git command successes regardless of success count", () => {
  assert.equal(
    shouldTriggerAfterSuccess({
      classification: { kind: "git", subcommand: "push" },
      rawCommand: "git push origin main",
    }),
    true,
  );
  assert.equal(
    shouldTriggerAfterSuccess({
      classification: { kind: "git", subcommand: "push" },
      rawCommand: "git push origin main",
    }),
    true,
  );
  assert.equal(
    shouldTriggerAfterSuccess({
      classification: { kind: "git", subcommand: "push" },
      rawCommand: "git push origin main",
    }),
    true,
  );
  assert.equal(
    shouldTriggerAfterSuccess({
      classification: { kind: "git", subcommand: "status" },
      rawCommand: "git status",
    }),
    false,
  );
  assert.equal(
    shouldTriggerAfterSuccess({
      classification: { kind: "other", reason: "External command: node" },
      rawCommand: "node -v",
    }),
    false,
  );
});

test("runCommandLine starts afterSuccess for key git command successes without waiting for it", async () => {
  const statsCwd = await createTempCwd();
  let releaseAfterSuccess: (() => void) | undefined;
  const contexts: unknown[] = [];

  const result = await runCommandLine("git push origin main", {
    statsCwd,
    executeCommand: async () => 0,
    initializeSession: async () => ({
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
          unstaged: 0,
          untracked: 2,
          dirty: true,
        },
      },
    }),
    agent: {
      afterSuccess(context) {
        contexts.push({
          gitStats: context.gitStats,
          gitRepository: context.gitRepository,
        });
        return new Promise((resolve) => {
          releaseAfterSuccess = () => resolve("pushed. consider opening a PR.");
        });
      },
    },
  });

  assert.equal(result.kind, "execute");
  assert.equal(result.exitCode, 0);
  assert.ok(result.afterSuccess);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(contexts, [
    {
      gitStats: {
        successCount: 1,
        failures: [],
      },
      gitRepository: {
        isRepository: true,
        root: "/repo",
        branch: "main",
        head: "abc1234",
        upstream: "origin/main",
        status: {
          staged: 1,
          unstaged: 0,
          untracked: 2,
          dirty: true,
        },
      },
    },
  ]);

  releaseAfterSuccess?.();
  assert.equal(await result.afterSuccess, "pushed. consider opening a PR.");
});

test("runCommandLine triggers afterSuccess even after repeated key command successes", async () => {
  const statsCwd = await createTempCwd();
  await recordGitCommandSuccess(statsCwd, "git push", new Date("2026-04-25T12:00:00.000Z"));
  await recordGitCommandSuccess(statsCwd, "git push origin main", new Date("2026-04-25T12:01:00.000Z"));
  const events: string[] = [];

  const result = await runCommandLine("git push origin main", {
    statsCwd,
    executeCommand: async () => 0,
    agent: {
      afterSuccess(context) {
        events.push(context.rawCommand);
      },
    },
  });

  assert.equal(result.kind, "execute");
  assert.ok(result.afterSuccess);
  await result.afterSuccess;
  assert.deepEqual(events, ["git push origin main"]);
  assert.deepEqual(await getGitCommandSuccessStats(statsCwd), {
    "git push": 3,
  });
});

test("runCommandLine skips afterSuccess for non-key successes and failures", async () => {
  const statsCwd = await createTempCwd();
  const events: string[] = [];

  const statusResult = await runCommandLine("git status", {
    statsCwd,
    executeCommand: async () => 0,
    agent: {
      afterSuccess(context) {
        events.push(context.rawCommand);
      },
    },
  });
  const failedResult = await runCommandLine("git push origin main", {
    statsCwd,
    executeCommand: async () => 1,
    agent: {
      afterSuccess(context) {
        events.push(context.rawCommand);
      },
    },
  });

  assert.equal(statusResult.kind, "execute");
  assert.equal(statusResult.afterSuccess, undefined);
  assert.equal(failedResult.kind, "execute");
  assert.equal(failedResult.afterSuccess, undefined);
  assert.deepEqual(events, []);
});
