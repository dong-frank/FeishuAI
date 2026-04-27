import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
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

test("parseCommandLine treats trailing question mark as an ordinary argument", () => {
  assert.deepEqual(parseCommandLine("git push ?"), {
    command: "git",
    args: ["push", "?"],
  });
  assert.deepEqual(parseCommandLine('git commit -m "why ?"'), {
    command: "git",
    args: ["commit", "-m", "why ?"],
  });
});

test("runCommandLine executes commands with question mark arguments normally", async () => {
  const calls: unknown[] = [];

  const result = await runCommandLine("git status ?", {
    executeCommand: async (command, args) => {
      calls.push({ command, args });
      return 0;
    },
  });

  assert.equal(result.kind, "execute");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [{ command: "git", args: ["status", "?"] }]);
});

test("runCommandLine reports command output chunks before completion", async () => {
  const chunks: Array<{ stream: "stdout" | "stderr"; text: string }> = [];

  const result = await runCommandLine("lark-cli config init --new", {
    onOutput(chunk) {
      chunks.push(chunk);
    },
    executeCommand: async (_command, _args, options) => {
      options.stdout?.write("qr line\n");
      options.stderr?.write("open link\n");
      return 0;
    },
  });

  assert.deepEqual(chunks, [
    { stream: "stdout", text: "qr line\n" },
    { stream: "stderr", text: "open link\n" },
  ]);
  assert.equal(result.stdout, "qr line\n");
  assert.equal(result.stderr, "open link\n");
});

test("runCommandLine passes cwd to ordinary external commands", async () => {
  const cwd = await createTempCwd();
  const calls: unknown[] = [];

  const result = await runCommandLine("node -v", {
    cwd,
    executeCommand: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return 0;
    },
  });

  assert.equal(result.kind, "execute");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [{ command: "node", args: ["-v"], cwd }]);
});

test("runCommandLine changes cwd for cd commands without spawning", async () => {
  const parent = await createTempCwd();
  const child = join(parent, "child");
  await mkdir(child);
  const calls: unknown[] = [];

  const result = await runCommandLine("cd ..", {
    cwd: child,
    executeCommand: async () => {
      calls.push("spawn");
      return 0;
    },
  });

  assert.equal(result.kind, "execute");
  assert.equal(result.exitCode, 0);
  assert.equal(result.nextCwd, parent);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(calls, []);
});

test("runCommandLine changes cwd to home for empty cd and cd tilde", async () => {
  const cwd = await createTempCwd();

  assert.equal((await runCommandLine("cd", { cwd })).nextCwd, homedir());
  assert.equal((await runCommandLine("cd ~", { cwd })).nextCwd, homedir());
});

test("runCommandLine reports failed cd without changing cwd", async () => {
  const cwd = await createTempCwd();
  const result = await runCommandLine("cd missing", { cwd });

  assert.equal(result.kind, "execute");
  assert.equal(result.exitCode, 1);
  assert.equal(result.nextCwd, undefined);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /cd: no such file or directory: missing/);
});

test("runCommandLine blocks recursive empty git-helper TUI launches", async () => {
  const calls: unknown[] = [];

  const result = await runCommandLine("git-helper", {
    executeCommand: async () => {
      calls.push("spawn");
      return 0;
    },
  });

  assert.equal(result.kind, "execute");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /cannot start git-helper inside git-helper TUI/);
  assert.deepEqual(calls, []);
});

test("runCommandLine starts lark init authorization agent without waiting", async () => {
  const events: unknown[] = [];
  let releaseAuthorize: (() => void) | undefined;
  const cwd = await createTempCwd();
  const result = await runCommandLine("lark init", {
    cwd,
    larkAgent: {
      authorize(context) {
        events.push(context);
        return new Promise((resolve) => {
          releaseAuthorize = () =>
            resolve({
              content: "auth phase ready",
              metadata: {
                durationMs: 2500,
                tokenUsage: {
                  totalTokens: 1031,
                },
              },
            });
        });
      },
    },
    executeCommand: async () => {
      throw new Error("external command should not run");
    },
  });

  assert.equal(result.kind, "execute");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "Lark authorization agent started in background.\n");
  assert.equal(result.stderr, "");
  assert.ok(result.afterSuccess);
  assert.equal(result.afterSuccessAgentKind, "lark");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    {
      cwd,
      intent: "init",
    },
  ]);
  releaseAuthorize?.();
  assert.deepEqual(await result.afterSuccess, {
    content: "auth phase ready",
    metadata: {
      durationMs: 2500,
      tokenUsage: {
        totalTokens: 1031,
      },
    },
  });
});

test("runCommandLine reports unsupported lark custom commands without spawning", async () => {
  const result = await runCommandLine("lark nope", {
    executeCommand: async () => {
      throw new Error("external command should not run");
    },
  });

  assert.equal(result.kind, "execute");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unsupported lark command: nope/);
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
        branches: {
          local: ["main", "feature/agent-context"],
          remote: ["origin/main"],
        },
        remotes: [
          {
            name: "origin",
            fetchUrl: "https://github.com/dong/feishuAI.git",
            webUrl: "https://github.com/dong/feishuAI",
          },
        ],
      },
      lark: {
        isInstalled: true,
        isConnected: true,
        identity: "user",
        name: "Dong",
      },
    }),
    agent: {
      afterSuccess(context) {
        contexts.push({
          gitStats: context.gitStats,
          tuiSession: context.tuiSession,
        });
        return new Promise((resolve) => {
          releaseAfterSuccess = () =>
            resolve({
              content: "pushed. consider opening a PR.",
              suggestedCommand: "gh pr create",
            });
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
      tuiSession: {
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
          branches: {
            local: ["main", "feature/agent-context"],
            remote: ["origin/main"],
          },
          remotes: [
            {
              name: "origin",
              fetchUrl: "https://github.com/dong/feishuAI.git",
              webUrl: "https://github.com/dong/feishuAI",
            },
          ],
        },
        lark: {
          isInstalled: true,
          isConnected: true,
          identity: "user",
          name: "Dong",
        },
        header: {
          cwd: "/repo/worktree",
          gitSummary: "git: main abc1234 -> origin/main dirty S1 U0 ?2",
          larkSummary: "lark: connected user Dong",
        },
      },
    },
  ]);

  releaseAfterSuccess?.();
  assert.deepEqual(await result.afterSuccess, {
    content: "pushed. consider opening a PR.",
    suggestedCommand: "gh pr create",
  });
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

test("runCommandLine triggers afterFail for command-not-found failures", async () => {
  const events: unknown[] = [];

  const cwd = await createTempCwd();
  const result = await runCommandLine("aaa", {
    cwd,
    executeCommand: async (_command, _args, options) => {
      options.stderr?.write("command not found: aaa\n");
      return 127;
    },
    agent: {
      afterFail(context, commandResult) {
        events.push({ context, commandResult });
        return {
          content: "检查命令是否安装，或确认命令名是否输入正确。",
          suggestedCommand: "which aaa",
        };
      },
    },
  });

  assert.equal(result.kind, "execute");
  assert.equal(result.exitCode, 127);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "command not found: aaa\n");
  assert.ok(result.afterFail);
  assert.deepEqual(await result.afterFail, {
    content: "检查命令是否安装，或确认命令名是否输入正确。",
    suggestedCommand: "which aaa",
  });
  assert.deepEqual(events, [
    {
      context: {
        cwd,
        command: "aaa",
        args: [],
        rawCommand: "aaa",
        gitStats: {
          successCount: 0,
          failures: [],
        },
      },
      commandResult: {
        exitCode: 127,
        stdout: "",
        stderr: "command not found: aaa\n",
      },
    },
  ]);
});
