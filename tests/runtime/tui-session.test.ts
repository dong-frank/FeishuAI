import assert from "node:assert/strict";
import { homedir } from "node:os";
import test from "node:test";

import {
  formatTuiSessionCwdDisplay,
  formatTuiSessionGitDisplay,
  formatTuiSessionLarkSummary,
  formatTuiSessionLarkDisplay,
  formatTuiSessionGitSummary,
  initializeTuiSession,
  normalizeGitRemoteWebUrl,
  parseGitPorcelainStatus,
} from "../../src/runtime/tui-session.js";

test("initializeTuiSession records workspace, git repository, and lark status", async () => {
  const calls: string[][] = [];
  const larkCalls: string[][] = [];

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
      if (command === "branch --format=%(refname:short)") {
        return Promise.resolve({
          exitCode: 0,
          stdout: "main\nfeature/agent-context\n",
          stderr: "",
        });
      }
      if (command === "branch -r --format=%(refname:short)") {
        return Promise.resolve({
          exitCode: 0,
          stdout: "origin/HEAD\norigin/main\norigin/feature/agent-context\n",
          stderr: "",
        });
      }
      if (command === "remote -v") {
        return Promise.resolve({
          exitCode: 0,
          stdout:
            "origin\tgit@github.com:dong/feishuAI.git (fetch)\n" +
            "origin\tgit@github.com:dong/feishuAI.git (push)\n",
          stderr: "",
        });
      }

      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected command" });
    },
    runLarkCommand(args) {
      larkCalls.push(args);
      return Promise.resolve({
        exitCode: 0,
        stdout: '{"identity":"user","user":{"name":"Dong"}}',
        stderr: "",
      });
    },
  });

  assert.deepEqual(calls, [
    ["rev-parse", "--show-toplevel"],
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["rev-parse", "--short", "HEAD"],
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    ["status", "--porcelain=v1"],
    ["branch", "--format=%(refname:short)"],
    ["branch", "-r", "--format=%(refname:short)"],
    ["remote", "-v"],
  ]);
  assert.deepEqual(larkCalls, [["auth", "status"]]);
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
      branches: {
        local: ["main", "feature/agent-context"],
        remote: ["origin/main", "origin/feature/agent-context"],
      },
      remotes: [
        {
          name: "origin",
          fetchUrl: "git@github.com:dong/feishuAI.git",
          pushUrl: "git@github.com:dong/feishuAI.git",
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
  });
});

test("normalizeGitRemoteWebUrl recognizes common Git hosting URL forms", () => {
  assert.equal(
    normalizeGitRemoteWebUrl("git@github.com:owner/repo.git"),
    "https://github.com/owner/repo",
  );
  assert.equal(
    normalizeGitRemoteWebUrl("https://github.com/owner/repo.git"),
    "https://github.com/owner/repo",
  );
  assert.equal(
    normalizeGitRemoteWebUrl("git@gitlab.com:group/repo.git"),
    "https://gitlab.com/group/repo",
  );
  assert.equal(
    normalizeGitRemoteWebUrl("https://gitlab.com/group/repo.git"),
    "https://gitlab.com/group/repo",
  );
  assert.equal(normalizeGitRemoteWebUrl("file:///tmp/repo"), undefined);
});

test("initializeTuiSession reads current lark-cli auth status fields", async () => {
  const session = await initializeTuiSession({
    cwd: "/repo/worktree",
    now: new Date("2026-04-25T12:00:00.000Z"),
    runGitCommand() {
      return Promise.resolve({ exitCode: 128, stdout: "", stderr: "" });
    },
    runLarkCommand() {
      return Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify({
          identity: "user",
          tokenStatus: "valid",
          userName: "饶东申",
          userOpenId: "ou_be45663bf336a23da9696c6a25eb7c27",
        }),
        stderr: "",
      });
    },
  });

  assert.deepEqual(session.lark, {
    isInstalled: true,
    isConnected: true,
    identity: "user",
    name: "饶东申",
  });
});

test("initializeTuiSession treats invalid lark tokens as not logged in", async () => {
  const session = await initializeTuiSession({
    cwd: "/repo/worktree",
    now: new Date("2026-04-25T12:00:00.000Z"),
    runGitCommand() {
      return Promise.resolve({ exitCode: 128, stdout: "", stderr: "" });
    },
    runLarkCommand() {
      return Promise.resolve({
        exitCode: 0,
        stdout: JSON.stringify({
          identity: "user",
          tokenStatus: "expired",
          userName: "饶东申",
        }),
        stderr: "",
      });
    },
  });

  assert.deepEqual(session.lark, {
    isInstalled: true,
    isConnected: false,
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
    runLarkCommand() {
      return Promise.resolve({
        exitCode: 1,
        stdout: "",
        stderr: "not logged in",
      });
    },
  });

  assert.deepEqual(session, {
    startedAt: "2026-04-25T12:00:00.000Z",
    cwd: "/tmp/no-repo",
    git: {
      isRepository: false,
    },
    lark: {
      isInstalled: true,
      isConnected: false,
    },
  });
});

test("initializeTuiSession records missing lark-cli without throwing", async () => {
  const session = await initializeTuiSession({
    cwd: "/repo/worktree",
    now: new Date("2026-04-25T12:00:00.000Z"),
    runGitCommand() {
      return Promise.resolve({ exitCode: 128, stdout: "", stderr: "" });
    },
    runLarkCommand() {
      const error = new Error("spawn lark-cli ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      return Promise.reject(error);
    },
  });

  assert.deepEqual(session.lark, {
    isInstalled: false,
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
      branches: {
        local: ["main"],
        remote: ["origin/main"],
      },
      remotes: [
        {
          name: "origin",
          fetchUrl: "https://github.com/dong/feishuAI.git",
          webUrl: "https://github.com/dong/feishuAI",
        },
      ],
    }),
    "git: main abc1234 -> origin/main dirty S1 U2 ?3",
  );
  assert.equal(formatTuiSessionGitSummary({ isRepository: false }), "git: no repository");
});

test("formatTuiSessionGitDisplay uses readable git status chips", () => {
  assert.deepEqual(
    formatTuiSessionGitDisplay({
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
      branches: {
        local: ["main"],
        remote: ["origin/main"],
      },
      remotes: [],
    }),
    [
      { text: "main", tone: "primary" },
      { text: "abc1234", tone: "muted" },
      { text: "origin/main", tone: "info" },
      { text: "dirty", tone: "warning" },
      { text: "已暂存 1", tone: "warning" },
      { text: "已修改 2", tone: "warning" },
      { text: "新文件 3", tone: "warning" },
    ],
  );
  assert.deepEqual(
    formatTuiSessionGitDisplay({
      isRepository: true,
      root: "/repo",
      branch: "main",
      head: "abc1234",
      status: {
        staged: 0,
        unstaged: 0,
        untracked: 0,
        dirty: false,
      },
      branches: {
        local: ["main"],
        remote: [],
      },
      remotes: [],
    }),
    [
      { text: "main", tone: "primary" },
      { text: "abc1234", tone: "muted" },
      { text: "clean", tone: "success" },
    ],
  );
  assert.deepEqual(formatTuiSessionGitDisplay({ isRepository: false }), [
    { text: "非 Git 仓库", tone: "muted" },
  ]);
});

test("formatTuiSessionCwdDisplay keeps absolute path shape with compact middle folders", () => {
  const home = homedir().replace(/\/+$/, "");
  const git = {
    isRepository: true as const,
    root: `${home}/2026/feishuAI`,
    branch: "main",
    head: "abc1234",
    status: {
      staged: 0,
      unstaged: 0,
      untracked: 0,
      dirty: false,
    },
    branches: {
      local: ["main"],
      remote: [],
    },
    remotes: [],
  };

  assert.equal(
    formatTuiSessionCwdDisplay({
      cwd: `${home}/2026/feishuAI/src/tui`,
      git,
    }),
    "~/2/f/s/tui",
  );
  assert.equal(
    formatTuiSessionCwdDisplay({
      cwd: `${home}/2026/feishuAI`,
      git,
    }),
    "~/2/feishuAI",
  );
  assert.equal(
    formatTuiSessionCwdDisplay({
      cwd: home,
      git,
    }),
    "~",
  );
  assert.equal(
    formatTuiSessionCwdDisplay({
      cwd: "/tmp/workspace",
      git: { isRepository: false },
    }),
    "/t/workspace",
  );
});

test("formatTuiSessionLarkSummary keeps connection info compact", () => {
  assert.equal(
    formatTuiSessionLarkSummary({
      isInstalled: true,
      isConnected: true,
      identity: "user",
      name: "Dong",
    }),
    "lark: connected user Dong",
  );
  assert.equal(
    formatTuiSessionLarkSummary({
      isInstalled: true,
      isConnected: false,
    }),
    "lark: not logged in",
  );
  assert.equal(formatTuiSessionLarkSummary({ isInstalled: false }), "lark: not installed");
});

test("formatTuiSessionLarkDisplay uses readable connection chips", () => {
  assert.deepEqual(
    formatTuiSessionLarkDisplay({
      isInstalled: true,
      isConnected: true,
      identity: "user",
      name: "Dong",
    }),
    [
      { text: "已连接", tone: "success" },
      { text: "user Dong", tone: "muted" },
    ],
  );
  assert.deepEqual(formatTuiSessionLarkDisplay({ isInstalled: true, isConnected: false }), [
    { text: "未登录", tone: "warning" },
  ]);
  assert.deepEqual(formatTuiSessionLarkDisplay({ isInstalled: false }), [
    { text: "未安装", tone: "muted" },
  ]);
});
