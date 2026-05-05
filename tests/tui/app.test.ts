import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildChatCommandContext,
  buildBeforeRunContext,
  COMPLETION_GHOST_STYLE,
  CURSOR_STYLE,
  DEFAULT_AGENT_STATUS_WIDTH,
  TUI_FOOTER_TIPS,
  TUI_USAGE_TIPS,
  getAgentStatusWidth,
  getNextEditableInput,
  getAgentSuggestedCompletion,
  getNextRightArrowInput,
  getNextCommandHistoryInput,
  getOutputSections,
  getTuiMouseInputAction,
  getTuiMouseWheelAction,
  getPromptLineParts,
  getHistoryViewportHeight,
  getHistoryRows,
  replaceAgentHistoryEntry,
  omitCompletedAgentToolProgress,
  upsertAgentToolProgress,
  getSessionHeaderParts,
  getStatusBarParts,
  getStatusLine,
  getNextHistoryScrollOffset,
  getVisibleHistoryRows,
  DEFAULT_STATUS_TEXT,
  formatCommandDuration,
  getRenderedOutputText,
  getScrollingStatusText,
  getStatusPaneWidths,
  getTerminalTextWidth,
  INPUT_HISTORY_MARGIN_BOTTOM,
  isChatCommandInput,
  isHelpOutput,
  getOutputTextParts,
  parseAnsiTextParts,
  parseChatCommand,
  shouldRefreshSessionAfterCommand,
  shouldIgnoreTabAgentTrigger,
  shouldShowClassificationLine,
  sanitizeTuiText,
  shouldTriggerBeforeRunOnTab,
  WELCOME_BANNER_LINES,
  WELCOME_SUBTITLE,
  WELCOME_TITLE,
} from "../../src/tui/app.js";
import {
  recordGitCommandFailure,
  recordGitCommandSuccess,
} from "../../src/runtime/git-command-stats.js";
import { formatTuiSessionCwdDisplay } from "../../src/runtime/tui-session.js";

async function createTempCwd() {
  return mkdtemp(join(tmpdir(), "git-helper-tui-"));
}

test("completion ghost style is visually distinct from ordinary gray text", () => {
  assert.deepEqual(COMPLETION_GHOST_STYLE, {
    color: "black",
    dimColor: true,
  });
});

test("usage tips are recorded in one place for the status bar", () => {
  assert.ok(TUI_USAGE_TIPS.includes("按 Enter 执行命令"));
  assert.ok(TUI_USAGE_TIPS.includes("按 Tab 请求 Agent 帮助"));
  assert.ok(TUI_USAGE_TIPS.includes("按 → 接受命令或文件补全"));
  assert.ok(TUI_USAGE_TIPS.includes("按 ↑/↓ 切换命令历史"));
  assert.ok(TUI_USAGE_TIPS.includes("按 PageUp/PageDown 滚动输出历史"));
});

test("welcome copy uses terminal character art for the brand", () => {
  assert.equal(WELCOME_TITLE, "GITX");
  assert.deepEqual(WELCOME_BANNER_LINES, [
    "  ____ ___ _____ __  __",
    " / ___|_ _|_   _|\\ \\/ /",
    "| |  _ | |  | |   \\  / ",
    "| |_| || |  | |   /  \\ ",
    " \\____|___| |_|  /_/\\_\\",
  ]);
  assert.equal(WELCOME_SUBTITLE, "Git workflow assistant · 输入命令，或输入 exit 退出");
});

test("welcome copy scrolls as part of the history rows", () => {
  assert.deepEqual(getVisibleHistoryRows([], 7).map((row) => row.text), [
    ...WELCOME_BANNER_LINES,
    WELCOME_SUBTITLE,
    "",
  ]);

  const entries = Array.from({ length: 4 }, (_, index) => ({
    type: "input" as const,
    text: `git status ${index}`,
  }));
  assert.deepEqual(getVisibleHistoryRows(entries, 4).map((row) => row.text), [
    "$ git status 2",
    "",
    "$ git status 3",
    "",
  ]);
});

test("long command input history wraps before viewport clipping", () => {
  const command =
    'git commit -m "feat: 新增命令历史切换与鼠标滚轮滚动支持，优化TUI布局与终端交互体验"';

  const rows = getHistoryRows([{ type: "input", text: command }], 24).map(
    (row) => row.text,
  );

  assert.deepEqual(rows.slice(3), [
    '$ git commit -m "feat: ',
    "新增命令历史切换与鼠标滚",
    "轮滚动支持，优化TUI布局",
    '与终端交互体验"',
    "",
  ]);
});

test("session header includes initialized workspace and git information", () => {
  assert.deepEqual(
    getSessionHeaderParts({
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
      lark: {
        isInstalled: true,
        isConnected: true,
        identity: "user",
        name: "Dong",
      },
    }),
    {
      cwd: "/repo/worktree",
      gitSummary: "git: main abc1234 -> origin/main dirty S1 U0 ?2",
      larkSummary: "lark: connected user Dong",
      display: {
        cwd: "/r/worktree",
        git: [
          { text: "main", tone: "primary" },
          { text: "abc1234", tone: "muted" },
          { text: "origin/main", tone: "info" },
          { text: "已暂存 1", tone: "warning" },
          { text: "新文件 2", tone: "warning" },
        ],
        lark: [
          { text: "已连接", tone: "success" },
          { text: "user Dong", tone: "muted" },
        ],
      },
    },
  );
});

test("history viewport keeps only the most recent entries under the fixed header", () => {
  const entries = Array.from({ length: 12 }, (_, index) => ({
    type: "input" as const,
    text: `git status ${index}`,
  }));

  assert.deepEqual(
    getVisibleHistoryRows(entries, 5).map((row) => row.text),
    ["", "$ git status 10", "", "$ git status 11", ""],
  );
  assert.equal(getHistoryViewportHeight(24), 11);
  assert.equal(getHistoryViewportHeight(10), 0);
  assert.equal(getHistoryViewportHeight(13), 0);
  assert.equal(getHistoryViewportHeight(14), 1);
  assert.equal(getHistoryViewportHeight(undefined), 14);
});

test("history viewport clips long command output by rows before rendering", () => {
  const rows = getVisibleHistoryRows(
    [
      { type: "input", text: "git status" },
      {
        type: "output",
        result: {
          commandLine: "git status",
          kind: "execute",
          exitCode: 0,
          stdout: "line 1\nline 2\nline 3\nline 4\nline 5\n",
          stderr: "",
        },
      },
      { type: "input", text: "git add src/app.tsx" },
    ],
    4,
  );

  assert.deepEqual(rows.map((row) => row.text), [
    "line 4",
    "line 5",
    "$ git add src/app.tsx",
    "",
  ]);
});

test("agent command output is visually distinct from user input commands", () => {
  const rows = getHistoryRows([
    { type: "input", text: "git status" },
    {
      type: "output",
      source: "agent",
      result: {
        commandLine: "lark-cli auth status",
        kind: "execute",
        exitCode: 0,
        stdout: "ready\n",
        stderr: "",
      },
    },
  ]);

  const userCommandRow = rows.find((row) => row.text === "$ git status");
  assert.equal(userCommandRow?.color, "green");

  const agentCommandRow = rows.find((row) => row.text === "agent: lark-cli auth status");
  assert.equal(agentCommandRow?.color, "magenta");
  assert.equal(agentCommandRow?.bold, true);

  const agentOutputRow = rows.find((row) => row.text === "ready");
  assert.equal(agentOutputRow?.parts?.[0]?.color, "magenta");
});

test("pending agent history renders compact tool progress", () => {
  const rows = getHistoryRows([
    {
      type: "agent",
      id: "agent-1",
      agentKind: "command",
      commandLine: "git status",
      state: "pending",
      activity: "waiting",
      toolProgress: [
        {
          id: "tool-1",
          toolName: "load_skill",
          state: "success",
          agentKind: "command",
          inputSummary: "skillName=command-help",
          durationMs: 42,
        },
        {
          id: "tool-2",
          toolName: "interact_with_lark_agent",
          state: "success",
          agentKind: "command",
          inputSummary: "action=get_context",
        },
        {
          id: "tool-3",
          toolName: "run_lark_cli",
          state: "running",
          agentKind: "lark",
          inputSummary: "auth status",
        },
      ],
    },
  ]);

  assert.ok(rows.some((row) => row.text === "GITX"));
  assert.equal(rows.some((row) => row.text === "Git Agent"), false);
  assert.equal(rows.some((row) => row.text === "Lark Agent"), false);

  const toolRows = rows.filter((row) => row.text.includes("─ "));
  assert.deepEqual(
    toolRows.map((row) => ({
      text: row.text,
      rightText: row.rightText,
    })),
    [
      { text: "  ├─ load_skill skillName=command-help", rightText: "[Git Agent]" },
      { text: "  ├─ interact_with_lark_agent action=get_context", rightText: "[Git Agent]" },
      { text: "  └─ run_lark_cli auth status", rightText: "[Lark Agent]" },
    ],
  );
  assert.equal(rows.some((row) => row.text === "Waiting for agent response..."), false);

  const completedRow = rows.find((row) => row.text === "    ├─ load_skill");
  assert.equal(completedRow, undefined);

  const firstToolRow = rows.find(
    (row) => row.text === "  ├─ load_skill skillName=command-help",
  );
  assert.equal(firstToolRow?.rightText, "[Git Agent]");
  assert.equal(firstToolRow?.color, "gray");
  assert.equal(firstToolRow?.rightColor, "cyan");

  const larkCallRow = rows.find(
    (row) => row.text === "  ├─ interact_with_lark_agent action=get_context",
  );
  assert.equal(larkCallRow?.rightText, "[Git Agent]");
  assert.equal(larkCallRow?.color, "gray");
  assert.equal(larkCallRow?.rightColor, "cyan");

  const runningRow = rows.find((row) => row.text === "  └─ run_lark_cli auth status");
  assert.equal(runningRow?.rightText, "[Lark Agent]");
  assert.equal(runningRow?.color, "magenta");
  assert.equal(runningRow?.rightColor, "magenta");
  assert.equal(runningRow?.rightText, "[Lark Agent]");
});

test("agent tool progress truncates tool name and params to 50 characters", () => {
  const rows = getHistoryRows([
    {
      type: "agent",
      id: "agent-1",
      agentKind: "lark",
      commandLine: "git push",
      state: "pending",
      toolProgress: [
        {
          id: "tool-1",
          toolName: "run_lark_cli",
          state: "running",
          agentKind: "lark",
          inputSummary: "docs fetch really-long-document-title with-extra-args",
        },
      ],
    },
  ]);

  const toolRow = rows.find((row) => row.text.includes("run_lark_cli"));
  assert.equal(toolRow?.text, "  └─ run_lark_cli docs fetch really-long-document-ti...");
  assert.equal(getTerminalTextWidth(toolRow?.text.replace(/^  └─ /, "") ?? ""), 50);
});

test("agent tool progress keeps call order when returning from lark to git", () => {
  const rows = getHistoryRows([
    {
      type: "agent",
      id: "agent-1",
      agentKind: "command",
      commandLine: "git commit",
      state: "pending",
      toolProgress: [
        {
          id: "tool-1",
          toolName: "load_skill",
          state: "success",
          agentKind: "command",
        },
        {
          id: "tool-2",
          toolName: "interact_with_lark_agent",
          state: "success",
          agentKind: "command",
        },
        {
          id: "tool-3",
          toolName: "load_skill",
          state: "success",
          agentKind: "lark",
        },
        {
          id: "tool-4",
          toolName: "git_commit_context",
          state: "running",
          agentKind: "command",
        },
      ],
    },
  ]);

  assert.deepEqual(
    rows
      .filter((row) => row.text.includes("─ "))
      .map((row) => `${row.rightText} ${row.text}`),
    [
      "[Git Agent]   ├─ load_skill",
      "[Git Agent]   ├─ interact_with_lark_agent",
      "[Lark Agent]   ├─ load_skill",
      "[Git Agent]   └─ git_commit_context",
    ],
  );
});

test("agent tool progress upsert keeps git and lark events with colliding ids", () => {
  const progress = [
    {
      id: "tool-1",
      toolName: "load_skill",
      state: "running" as const,
      agentKind: "command" as const,
    },
  ];

  const withLarkEvent = upsertAgentToolProgress(progress, {
    id: "tool-1",
    toolName: "load_skill",
    state: "running",
    agentKind: "lark",
  });
  const afterGitUpdate = upsertAgentToolProgress(withLarkEvent, {
    id: "tool-1",
    toolName: "load_skill",
    state: "success",
    agentKind: "command",
  });

  assert.deepEqual(
    afterGitUpdate.map((event) => ({
      id: event.id,
      state: event.state,
      agentKind: event.agentKind,
    })),
    [
      { id: "tool-1", state: "success", agentKind: "command" },
      { id: "tool-1", state: "running", agentKind: "lark" },
    ],
  );
});

test("agent tool progress upsert keeps every distinct tool event", () => {
  const progress = Array.from({ length: 10 }, (_, index) => ({
      id: `tool-${index + 1}`,
      toolName: "run_lark_cli",
      state: "success" as const,
      agentKind: "lark" as const,
      inputSummary: `command-${index + 1}`,
    })).reduce((current, event) => upsertAgentToolProgress(current, event), []);

  const next = upsertAgentToolProgress(progress, {
    id: "tool-11",
    toolName: "run_lark_cli",
    state: "running",
    agentKind: "lark",
    inputSummary: "command-11",
  });

  assert.equal(next.length, 11);
  assert.equal(next[0]?.inputSummary, "command-1");
  assert.equal(next.at(-1)?.inputSummary, "command-11");
});

test("agent history replacement keeps progress after success or empty output", () => {
  const history = [
    {
      type: "agent" as const,
      id: "agent-1",
      agentKind: "command" as const,
      commandLine: "git status",
      state: "pending" as const,
      toolProgress: [
        {
          id: "tool-1",
          toolName: "load_skill",
          state: "success" as const,
          durationMs: 42,
        },
      ],
    },
  ];

  const successRows = getHistoryRows(
    replaceAgentHistoryEntry(history, "agent-1", {
      state: "success",
      content: "最终建议",
    }),
  );
  const emptyRows = getHistoryRows(
    replaceAgentHistoryEntry(history, "agent-1", {
      state: "empty",
    }),
  );

  assert.equal(successRows.some((row) => row.text.includes("load_skill")), true);
  assert.equal(successRows.some((row) => row.text === "最终建议"), true);
  assert.equal(emptyRows.some((row) => row.text.includes("load_skill")), true);
  assert.equal(emptyRows.some((row) => row.text === "No agent suggestion generated."), true);
});

test("completed agent tool progress is omitted when the next command is submitted", () => {
  const history = omitCompletedAgentToolProgress([
    {
      type: "agent",
      id: "agent-1",
      agentKind: "command",
      commandLine: "git status",
      state: "success",
      content: "最终建议",
      toolProgress: [
        {
          id: "tool-1",
          toolName: "load_skill",
          state: "success",
        },
      ],
    },
    {
      type: "agent",
      id: "agent-2",
      agentKind: "command",
      commandLine: "git push",
      state: "failed",
      error: "Agent failed",
      toolProgress: [
        {
          id: "tool-2",
          toolName: "git_repository_context",
          state: "failed",
        },
      ],
    },
    { type: "input", text: "git log" },
  ]);

  const rows = getHistoryRows(history);

  assert.equal(rows.some((row) => row.text.includes("load_skill")), false);
  assert.equal(rows.some((row) => row.text.includes("git_repository_context")), false);
  assert.equal(rows.some((row) => row.text === "最终建议"), true);
  assert.equal(rows.some((row) => row.text === "Agent failed"), true);
});

test("agent history replacement preserves progress after failure", () => {
  const rows = getHistoryRows(
    replaceAgentHistoryEntry(
      [
        {
          type: "agent",
          id: "agent-1",
          agentKind: "command",
          commandLine: "git status",
          state: "pending",
          toolProgress: [
            {
              id: "tool-1",
              toolName: "git_repository_context",
              state: "failed",
              durationMs: 42,
              error: "git failed",
            },
          ],
        },
      ],
      "agent-1",
      {
        state: "failed",
        error: "Agent failed",
      },
    ),
  );

  const failedRow = rows.find((row) => row.text === "  └─ git_repository_context");
  assert.equal(failedRow?.rightText, "[Git Agent]");
  assert.equal(failedRow?.color, "red");
  assert.equal(rows.some((row) => row.text.includes("git failed")), false);
  assert.equal(rows.some((row) => row.text === "Agent failed"), true);
});

test("executed command history keeps duration and failure code in a right-side field", () => {
  const rows = getHistoryRows([
    { type: "input", text: "git status" },
    {
      type: "output",
      result: {
        commandLine: "git status",
        kind: "execute",
        exitCode: 0,
        durationMs: 42,
        stdout: "",
        stderr: "",
      },
    },
    { type: "input", text: "git push" },
    {
      type: "output",
      result: {
        commandLine: "git push",
        kind: "execute",
        exitCode: 128,
        durationMs: 1234,
        stdout: "",
        stderr: "failed\n",
      },
    },
  ]);

  const successCommandRow = rows.find((row) => row.text === "$ git status");
  assert.equal(successCommandRow?.color, "green");
  assert.equal(successCommandRow?.rightText, "[✓ 42ms]");
  assert.equal(successCommandRow?.rightColor, "green");

  const failedCommandRow = rows.find((row) => row.text === "$ git push");
  assert.equal(failedCommandRow?.color, "red");
  assert.equal(failedCommandRow?.rightText, "[✗ 128 1.2s]");
  assert.equal(failedCommandRow?.rightColor, "red");
  assert.equal(rows.some((row) => row.text === "exit code: 128"), false);
});

test("command history keeps right-side status on the final wrapped command row", () => {
  const rows = getHistoryRows(
    [
      { type: "input", text: "git status --short" },
      {
        type: "output",
        result: {
          commandLine: "git status --short",
          kind: "execute",
          exitCode: 0,
          durationMs: 900,
          stdout: "",
          stderr: "",
        },
      },
    ],
    12,
  );

  assert.equal(rows[3]?.text, "$ git status");
  assert.equal(rows[3]?.rightText, undefined);
  assert.equal(rows[4]?.text, " --short");
  assert.equal(rows[4]?.rightText, "[✓ 900ms]");
  assert.equal(rows[5]?.text, "");
});

test("command duration text uses compact shell-style units", () => {
  assert.equal(formatCommandDuration(42.4), "42ms");
  assert.equal(formatCommandDuration(1234), "1.2s");
  assert.equal(formatCommandDuration(12_345), "12s");
  assert.equal(formatCommandDuration(61_234), "1m1s");
});

test("failed command history colors the submitted command red", () => {
  const rows = getHistoryRows([
    { type: "input", text: "aaa" },
    {
      type: "output",
      result: {
        commandLine: "aaa",
        kind: "execute",
        exitCode: 127,
        stdout: "",
        stderr: "command not found: aaa\n",
      },
    },
  ]);

  const failedCommandRow = rows.find((row) => row.text === "$ aaa");
  assert.equal(failedCommandRow?.color, "red");

  const stderrRow = rows.find((row) => row.text === "command not found: aaa");
  assert.equal(stderrRow?.parts?.[0]?.color, undefined);
});

test("history viewport supports scrolling through older rows", () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    type: "input" as const,
    text: `git status ${index}`,
  }));

  assert.deepEqual(
    getVisibleHistoryRows(history, 4, 0).map((row) => row.text),
    ["$ git status 6", "", "$ git status 7", ""],
  );
  assert.deepEqual(
    getVisibleHistoryRows(history, 4, 4).map((row) => row.text),
    ["$ git status 4", "", "$ git status 5", ""],
  );
  assert.equal(getNextHistoryScrollOffset(0, "pageUp", 16, 4), 4);
  assert.equal(getNextHistoryScrollOffset(4, "pageDown", 16, 4), 0);
  assert.equal(getNextHistoryScrollOffset(40, "pageUp", 16, 4), 12);
  assert.equal(getNextHistoryScrollOffset(0, "wheelUp", 16, 4), 3);
  assert.equal(getNextHistoryScrollOffset(3, "wheelDown", 16, 4), 0);
});

test("mouse wheel input maps SGR mouse events to history scroll actions", () => {
  assert.equal(getTuiMouseWheelAction("\u001b[<64;10;20M"), "wheelUp");
  assert.equal(getTuiMouseWheelAction("[<65;10;20M"), "wheelDown");
  assert.equal(getTuiMouseWheelAction("\u001b[A"), undefined);
  assert.deepEqual(getTuiMouseInputAction("\u001b[<64;10;20M"), {
    kind: "wheel",
    action: "wheelUp",
  });
  assert.deepEqual(getTuiMouseInputAction("[<0;32;20M"), {
    kind: "ignored",
  });
  assert.deepEqual(getTuiMouseInputAction("[<0;32;20m"), {
    kind: "ignored",
  });
  assert.equal(getTuiMouseInputAction("\u001b[A"), undefined);
});

test("slash chat command parser extracts non-empty chat messages", () => {
  assert.deepEqual(parseChatCommand("/chat 怎么解决 upstream 报错"), {
    rawCommand: "/chat 怎么解决 upstream 报错",
    message: "怎么解决 upstream 报错",
  });
  assert.deepEqual(parseChatCommand("   /chat   git commit 前应该检查什么   "), {
    rawCommand: "/chat   git commit 前应该检查什么",
    message: "git commit 前应该检查什么",
  });
  assert.equal(parseChatCommand("/chat"), undefined);
  assert.equal(parseChatCommand("/chat   "), undefined);
  assert.equal(parseChatCommand("/chatty hello"), undefined);
  assert.equal(parseChatCommand("git status"), undefined);
  assert.equal(isChatCommandInput("/chat\thello"), true);
  assert.equal(isChatCommandInput("/chatty hello"), false);
});

test("slash chat builds command agent context without git command stats", () => {
  const context = buildChatCommandContext({
    input: "/chat 怎么解决 upstream 报错",
    cwd: "/repo/worktree",
    session: {
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
      lark: {
        isInstalled: true,
        isConnected: true,
        identity: "user",
        name: "Dong",
      },
    },
  });

  assert.deepEqual(context, {
    cwd: "/repo/worktree",
    command: "/chat",
    args: ["怎么解决 upstream 报错"],
    rawCommand: "/chat 怎么解决 upstream 报错",
    message: "怎么解决 upstream 报错",
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
        display: {
          cwd: "/r/worktree",
          git: [
            { text: "main", tone: "primary" },
            { text: "abc1234", tone: "muted" },
            { text: "origin/main", tone: "info" },
            { text: "已暂存 1", tone: "warning" },
            { text: "新文件 2", tone: "warning" },
          ],
          lark: [
            { text: "已连接", tone: "success" },
            { text: "user Dong", tone: "muted" },
          ],
        },
      },
    },
  });
});

test("slash chat is not treated as beforeRun git help", () => {
  assert.equal(
    shouldTriggerBeforeRunOnTab({
      input: "/chat git status 是什么",
      isRunning: false,
    }),
    false,
  );
});

test("session refresh is triggered after real git or lark command execution", () => {
  assert.equal(
    shouldRefreshSessionAfterCommand({
      commandLine: "git status",
      kind: "execute",
      classification: { kind: "git", subcommand: "status" },
      exitCode: 0,
      stdout: "",
      stderr: "",
    }),
    true,
  );
  assert.equal(
    shouldRefreshSessionAfterCommand({
      commandLine: "git status ?",
      kind: "help",
      classification: { kind: "git", subcommand: "status" },
      exitCode: 0,
      stdout: "",
      stderr: "",
      help: "usage",
    }),
    false,
  );
  assert.equal(
    shouldRefreshSessionAfterCommand({
      commandLine: "lark status",
      kind: "execute",
      classification: { kind: "custom", name: "lark" },
      exitCode: 0,
      stdout: "",
      stderr: "",
    }),
    true,
  );
  assert.equal(
    shouldRefreshSessionAfterCommand({
      commandLine: "cd ..",
      kind: "execute",
      classification: { kind: "custom", name: "cd" },
      exitCode: 0,
      stdout: "",
      stderr: "",
      nextCwd: "/repo",
    }),
    true,
  );
  assert.equal(
    shouldRefreshSessionAfterCommand({
      commandLine: "node -v",
      kind: "execute",
      classification: { kind: "external" },
      exitCode: 0,
      stdout: "",
      stderr: "",
    }),
    false,
  );
});

test("cursor style uses inverse video so the input position is visible", () => {
  assert.deepEqual(CURSOR_STYLE, {
    inverse: true,
  });
});

test("prompt line shows the cursor at the input boundary before completion", () => {
  assert.deepEqual(
    getPromptLineParts({ input: "git sta", cursorIndex: 7, completionSuffix: "tus" }),
    {
      beforeCursor: "git sta",
      cursor: "t",
      completionSuffix: "us",
      afterCursor: "",
    },
  );
});

test("prompt line shows a cursor placeholder when there is no completion", () => {
  assert.deepEqual(getPromptLineParts({ input: "git status", cursorIndex: 10 }), {
    beforeCursor: "git status",
    cursor: " ",
    completionSuffix: "",
    afterCursor: "",
  });
});

test("prompt line can render the cursor inside input text", () => {
  assert.deepEqual(getPromptLineParts({ input: "git status", cursorIndex: 4 }), {
    beforeCursor: "git ",
    cursor: "s",
    completionSuffix: "",
    afterCursor: "tatus",
  });
});

test("editable input handles left and right cursor movement", () => {
  assert.deepEqual(getNextEditableInput({ input: "git status", cursorIndex: 10 }, "left"), {
    input: "git status",
    cursorIndex: 9,
  });
  assert.deepEqual(getNextEditableInput({ input: "git status", cursorIndex: 9 }, "right"), {
    input: "git status",
    cursorIndex: 10,
  });
  assert.deepEqual(getNextEditableInput({ input: "git status", cursorIndex: 0 }, "left"), {
    input: "git status",
    cursorIndex: 0,
  });
});

test("right arrow accepts completion before moving the cursor", () => {
  assert.deepEqual(
    getNextRightArrowInput({
      input: "git sta",
      cursorIndex: 7,
      completion: {
        completion: "git status",
        suffix: "tus",
      },
    }),
    {
      input: "git status",
      cursorIndex: 10,
    },
  );
  assert.deepEqual(
    getNextRightArrowInput({
      input: "git status",
      cursorIndex: 4,
      completion: undefined,
    }),
    {
      input: "git status",
      cursorIndex: 5,
    },
  );
});

test("agent suggested completion is available only when current input is its prefix", () => {
  assert.deepEqual(
    getAgentSuggestedCompletion({
      input: "git commit -m",
      suggestedCommand: 'git commit -m "feat: add structured output"',
    }),
    {
      completion: 'git commit -m "feat: add structured output"',
      suffix: ' "feat: add structured output"',
    },
  );
  assert.equal(
    getAgentSuggestedCompletion({
      input: "git status",
      suggestedCommand: 'git commit -m "feat: add structured output"',
    }),
    undefined,
  );
});

test("right arrow prefers agent suggested completion over local completion", () => {
  assert.deepEqual(
    getNextRightArrowInput({
      input: "git sta",
      cursorIndex: 7,
      completion: {
        completion: "git status",
        suffix: "tus",
      },
      agentCompletion: {
        completion: "git stash",
        suffix: "sh",
      },
    }),
    {
      input: "git stash",
      cursorIndex: 9,
    },
  );
});

test("editable input inserts and deletes at the cursor", () => {
  assert.deepEqual(
    getNextEditableInput({ input: "git status", cursorIndex: 4 }, { type: "insert", text: "x" }),
    {
      input: "git xstatus",
      cursorIndex: 5,
    },
  );
  assert.deepEqual(
    getNextEditableInput({ input: "git xstatus", cursorIndex: 5 }, "backspace"),
    {
      input: "git status",
      cursorIndex: 4,
    },
  );
  assert.deepEqual(
    getNextEditableInput({ input: "git xstatus", cursorIndex: 4 }, "delete"),
    {
      input: "git status",
      cursorIndex: 4,
    },
  );
});

test("command history navigation walks submitted commands and restores the draft", () => {
  const commands = ["git status", "git diff", "git log --oneline"];

  const previous = getNextCommandHistoryInput(
    {
      commands,
      currentInput: "git sta",
      currentIndex: undefined,
      draftInput: "",
    },
    "previous",
  );
  assert.deepEqual(previous, {
    input: "git log --oneline",
    cursorIndex: 17,
    historyIndex: 2,
    draftInput: "git sta",
  });

  const older = getNextCommandHistoryInput(
    {
      commands,
      currentInput: previous.input,
      currentIndex: previous.historyIndex,
      draftInput: previous.draftInput,
    },
    "previous",
  );
  assert.deepEqual(older, {
    input: "git diff",
    cursorIndex: 8,
    historyIndex: 1,
    draftInput: "git sta",
  });

  const newer = getNextCommandHistoryInput(
    {
      commands,
      currentInput: older.input,
      currentIndex: older.historyIndex,
      draftInput: older.draftInput,
    },
    "next",
  );
  assert.deepEqual(newer, {
    input: "git log --oneline",
    cursorIndex: 17,
    historyIndex: 2,
    draftInput: "git sta",
  });

  assert.deepEqual(
    getNextCommandHistoryInput(
      {
        commands,
        currentInput: newer.input,
        currentIndex: newer.historyIndex,
        draftInput: newer.draftInput,
      },
      "next",
    ),
    {
      input: "git sta",
      cursorIndex: 7,
      historyIndex: undefined,
      draftInput: "git sta",
    },
  );
});

test("status line keeps waiting indicators outside the prompt box", () => {
  assert.equal(
    DEFAULT_STATUS_TEXT,
    "按 Enter 执行命令",
  );
  assert.equal(
    getStatusLine({ isRunning: false, isAgentWaiting: false }),
    DEFAULT_STATUS_TEXT,
  );
  assert.equal(
    getStatusLine({ isRunning: false, isAgentWaiting: false, tipIndex: 1 }),
    "按 Tab 请求 Agent 帮助",
  );
  assert.equal(
    getStatusLine({ isRunning: true, isAgentWaiting: false }),
    "命令：正在执行 ...",
  );
  assert.equal(
    getStatusLine({
      isRunning: false,
      isAgentWaiting: true,
      agentKind: "command",
      agentCommand: "git status",
    }),
    "正在请求帮助 git status ...",
  );
  assert.equal(
    getStatusLine({
      isRunning: false,
      isAgentWaiting: true,
      agentKind: "lark",
      agentCommand: "lark init",
    }),
    "正在处理 lark init ...",
  );
  assert.equal(
    getStatusLine({
      isRunning: true,
      isAgentWaiting: true,
      agentKind: "command",
      agentCommand: "git status",
    }),
    "正在请求帮助 git status ...",
  );
  assert.equal(
    getStatusLine({
      isRunning: false,
      isAgentWaiting: false,
      isAgentReviewing: true,
      agentKind: "command",
      agentCommand: "git push",
    }),
    "正在检查 git push ...",
  );
});

test("status bar keeps only usage tips", () => {
  assert.deepEqual(
    getStatusBarParts({
      isRunning: false,
      isAgentWaiting: false,
      tipIndex: 1,
    }),
    {
      left: TUI_FOOTER_TIPS,
      right: "",
    },
  );
  assert.deepEqual(
    getStatusBarParts({
      isRunning: false,
      isAgentWaiting: true,
      agentKind: "command",
      agentCommand: "git commit -m",
      tipIndex: 1,
    }),
    {
      left: TUI_FOOTER_TIPS,
      right: "",
    },
  );
  assert.deepEqual(
    getStatusBarParts({
      isRunning: false,
      isAgentWaiting: true,
      agentKind: "lark",
      agentCommand: "lark init",
      tipIndex: 1,
      agentStatusWidth: 28,
    }),
    {
      left: TUI_FOOTER_TIPS,
      right: "",
    },
  );
  assert.deepEqual(
    getStatusBarParts({
      isRunning: true,
      isAgentWaiting: false,
      tipIndex: 1,
    }),
    {
      left: TUI_FOOTER_TIPS,
      right: "",
    },
  );
});

test("status text uses a bounded viewport and scrolls long text with ellipsis", () => {
  assert.equal(DEFAULT_AGENT_STATUS_WIDTH, 28);
  assert.equal(getAgentStatusWidth(undefined), 0);
  assert.deepEqual(getStatusPaneWidths(undefined), { left: 28, right: 0 });
  assert.deepEqual(getStatusPaneWidths(40), { left: 36, right: 0 });
  assert.deepEqual(getStatusPaneWidths(120), { left: 116, right: 0 });
  assert.equal(getAgentStatusWidth(40), 0);
  assert.equal(getAgentStatusWidth(120), 0);
  assert.equal(getTerminalTextWidth("空闲"), 4);
  assert.equal(getTerminalTextWidth("按 Tab 请求 Agent 帮助"), 22);

  assert.equal(
    getScrollingStatusText({
      text: "空闲",
      width: 24,
      offset: 10,
    }),
    "空闲",
  );
  assert.equal(
    getScrollingStatusText({
      text: "正在请求帮助 git commit --amend --no-edit --verbose ...",
      width: 24,
      offset: 0,
    }),
    "正在请求帮助 git comm...",
  );
  assert.equal(
    getScrollingStatusText({
      text: "正在请求帮助 git commit --amend --no-edit --verbose ...",
      width: 24,
      offset: 10,
    }),
    "...助 git commit --am...",
  );
  assert.deepEqual(
    getStatusBarParts({
      isRunning: false,
      isAgentWaiting: true,
      agentKind: "command",
      agentCommand: "git commit --amend --no-edit --verbose",
      tipStatusWidth: 14,
      tipStatusScrollOffset: 4,
      agentStatusWidth: 24,
      agentStatusScrollOffset: 10,
    }),
    {
      left: "[Enter]执行...",
      right: "",
    },
  );
});

test("output sections keep help responses separate from command stdout", () => {
  assert.deepEqual(
    getOutputSections({
      commandLine: "git push ?",
      kind: "help",
      exitCode: 0,
      stdout: "",
      stderr: "",
      help: "push help",
    }),
    {
      label: "help",
      body: "push help",
    },
  );
});

test("classification metadata is not rendered as a history line", () => {
  assert.equal(shouldShowClassificationLine(), false);
});

test("output labels are not rendered before history text", () => {
  assert.equal(getRenderedOutputText({ label: "output", body: "hello" }), "hello");
  assert.equal(getRenderedOutputText({ label: "help", body: "usage" }), "usage");
});

test("input history lines reserve a blank spacer before command output", () => {
  assert.equal(INPUT_HISTORY_MARGIN_BOTTOM, 1);
});

test("help output is rendered in a banner instead of normal history text", () => {
  assert.equal(
    isHelpOutput({
      commandLine: "git status ?",
      kind: "help",
      exitCode: 0,
      stdout: "",
      stderr: "",
      help: "usage",
    }),
    true,
  );
  const rows = getHistoryRows([
    {
      type: "output",
      result: {
        commandLine: "git status",
        kind: "execute",
        exitCode: 0,
        stdout: "status output\n",
        stderr: "",
      },
    },
    {
      type: "output",
      result: {
        commandLine: "git commit",
        kind: "help",
        agentKind: "command",
        exitCode: 0,
        stdout: "",
        stderr: "",
        help: "feat: add agent metrics",
        agentMetadata: {
          durationMs: 1234,
          tokenUsage: {
            totalTokens: 456,
          },
        },
      },
    },
    {
      type: "output",
      result: {
        commandLine: "lark init",
        kind: "help",
        agentKind: "lark",
        exitCode: 0,
        stdout: "",
        stderr: "",
        help: "auth ready",
        agentMetadata: {
          durationMs: 2500,
          tokenUsage: {
            totalTokens: 1031,
          },
          contextUsage: {
            messageCount: 6,
            characterCount: 4120,
            estimatedTokens: 1030,
          },
        },
      },
    },
  ]);
  const agentTitles = rows.filter((row) => row.text === "GITX");
  const firstAgentTitleIndex = rows.findIndex((row) => row.text === "GITX");
  assert.equal(rows[firstAgentTitleIndex - 1]?.text, "");
  assert.equal(agentTitles[0]?.rightText, "[✓ 1.2s · 456 tokens]");
  assert.equal(agentTitles[0]?.rightColor, "cyan");
  assert.equal(agentTitles[1]?.rightText, "[✓ 2.5s · 1031 tokens · ctx 1030 tokens]");
  assert.equal(agentTitles[1]?.rightColor, "cyan");
  assert.equal(
    isHelpOutput({
      commandLine: "git status",
      kind: "execute",
      exitCode: 0,
      stdout: "status",
      stderr: "",
    }),
    false,
  );
});

test("agent history entries render pending, success, failed, and empty states", () => {
  const rows = getHistoryRows([
    {
      type: "agent",
      id: "agent-1",
      agentKind: "command",
      commandLine: "git commit",
      state: "pending",
      activity: "waiting",
    },
    {
      type: "agent",
      id: "agent-2",
      agentKind: "lark",
      commandLine: "lark init",
      state: "success",
      content: "auth ready",
      metadata: {
        durationMs: 2500,
        tokenUsage: {
          totalTokens: 1031,
        },
        contextUsage: {
          messageCount: 6,
          characterCount: 4120,
          estimatedTokens: 1030,
        },
      },
    },
    {
      type: "agent",
      id: "agent-3",
      agentKind: "command",
      commandLine: "git push",
      state: "failed",
      error: "model timeout",
    },
    {
      type: "agent",
      id: "agent-4",
      agentKind: "command",
      commandLine: "git status",
      state: "empty",
    },
    {
      type: "agent",
      id: "agent-5",
      agentKind: "command",
      commandLine: "git push",
      state: "pending",
      activity: "reviewing",
    },
    {
      type: "agent",
      id: "agent-6",
      agentKind: "lark",
      commandLine: "lark init",
      state: "pending",
      activity: "reviewing",
    },
  ]);

  const agentTitles = rows.filter((row) => row.text === "GITX");
  assert.equal(agentTitles[0]?.rightText, undefined);
  assert.equal(agentTitles[2]?.rightText, "[failed]");
  assert.equal(agentTitles[2]?.rightColor, "red");
  assert.equal(agentTitles[3]?.rightText, "[done]");
  assert.equal(agentTitles[3]?.rightColor, "gray");
  assert.equal(agentTitles[4]?.rightText, undefined);
  assert.ok(rows.some((row) => row.text === "model timeout"));
  assert.ok(rows.some((row) => row.text === "No agent suggestion generated."));

  assert.equal(agentTitles[1]?.rightText, "[✓ 2.5s · 1031 tokens · ctx 1030 tokens]");
  assert.equal(agentTitles[1]?.rightColor, "cyan");
  assert.equal(agentTitles[5]?.rightText, undefined);
  assert.ok(rows.some((row) => row.text === "auth ready"));
  assert.equal(rows.some((row) => row.text === "Waiting for agent response..."), false);
});

test("agent history replacement keeps the original position", () => {
  const history = [
    {
      type: "input" as const,
      text: "git push",
    },
    {
      type: "agent" as const,
      id: "agent-1",
      agentKind: "command" as const,
      commandLine: "git push",
      state: "pending" as const,
    },
    {
      type: "input" as const,
      text: "git status",
    },
  ];

  assert.deepEqual(
    replaceAgentHistoryEntry(history, "agent-1", {
      state: "success",
      content: "pushed. consider opening a PR.",
    }),
    [
      history[0],
      {
        ...history[1],
        state: "success",
        content: "pushed. consider opening a PR.",
      },
      history[2],
    ],
  );
});

test("agent history entries render live agent command output under the agent banner", () => {
  const rows = getHistoryRows([
    {
      type: "agent",
      id: "agent-1",
      agentKind: "lark",
      commandLine: "lark init",
      state: "pending",
      stdout: "authorize link\n",
      stderr: "waiting for login\n",
    },
  ]);

  assert.ok(rows.some((row) => row.text === "GITX"));
  assert.equal(rows.some((row) => row.text === "agent: lark init"), false);
  assert.equal(rows.find((row) => row.text === "authorize link")?.parts?.[0]?.color, "magenta");
  assert.equal(rows.find((row) => row.text === "waiting for login")?.parts?.[0]?.color, "magenta");
});

test("output sections strip terminal control characters before rendering", () => {
  assert.equal(
    sanitizeTuiText("\u001b[2J\u001b[Hhello\rprogress\u0007\n\tnext"),
    "hello\nprogress\n  next",
  );
  assert.deepEqual(
    getOutputSections({
      commandLine: "demo",
      kind: "execute",
      exitCode: 0,
      stdout: "\u001b[31mred\u001b[0m\r\n\t",
      stderr: "\u001b[2Jbad\u0007",
    }),
    {
      label: "output",
      body: "red\n  bad",
    },
  );
});

test("output text parts preserve ANSI colors for Ink rendering", () => {
  assert.deepEqual(parseAnsiTextParts("\u001b[31mred\u001b[0m plain"), [
    { text: "red", color: "red" },
    { text: " plain" },
  ]);
  assert.deepEqual(
    getOutputTextParts({
      commandLine: "git status",
      kind: "execute",
      exitCode: 0,
      stdout: "\u001b[32mclean\u001b[0m\n",
      stderr: "",
    }),
    [{ text: "clean", color: "green" }, { text: "\n" }],
  );
});

test("beforeRun triggers only for complete Tab-requested git commands", () => {
  assert.equal(
    shouldTriggerBeforeRunOnTab({
      input: "git status",
      completionSuffix: undefined,
      isRunning: false,
    }),
    true,
  );
  assert.equal(
    shouldTriggerBeforeRunOnTab({
      input: "git sta",
      completionSuffix: "tus",
      isRunning: false,
    }),
    true,
  );
  assert.equal(
    shouldTriggerBeforeRunOnTab({
      input: "git pu",
      completionSuffix: undefined,
      isRunning: false,
    }),
    true,
  );
  assert.equal(
    shouldTriggerBeforeRunOnTab({
      input: "git status ?",
      completionSuffix: undefined,
      isRunning: false,
    }),
    true,
  );
  assert.equal(
    shouldTriggerBeforeRunOnTab({
      input: "git status",
      completionSuffix: undefined,
      isRunning: true,
    }),
    false,
  );
  assert.equal(
    shouldTriggerBeforeRunOnTab({
      input: "node -v",
      completionSuffix: undefined,
      isRunning: false,
    }),
    false,
  );
});

test("beforeRun handles git commit Tab requests", () => {
  assert.equal(
    shouldTriggerBeforeRunOnTab({
      input: "git commit",
      isRunning: false,
    }),
    true,
  );
  assert.equal(
    shouldTriggerBeforeRunOnTab({
      input: "git commit -m",
      isRunning: false,
    }),
    true,
  );
  assert.equal(
    shouldTriggerBeforeRunOnTab({
      input: "git commit -m \"message\"",
      isRunning: false,
    }),
    true,
  );
  assert.equal(
    shouldTriggerBeforeRunOnTab({
      input: "git commit",
      isRunning: true,
    }),
    false,
  );
});

test("repeated Tab agent triggers are ignored until input changes", () => {
  assert.equal(
    shouldIgnoreTabAgentTrigger({
      input: "git status",
      lastTriggeredInput: undefined,
      isAgentBusy: false,
    }),
    false,
  );
  assert.equal(
    shouldIgnoreTabAgentTrigger({
      input: "git status",
      lastTriggeredInput: "git status",
      isAgentBusy: false,
    }),
    true,
  );
  assert.equal(
    shouldIgnoreTabAgentTrigger({
      input: "git status --short",
      lastTriggeredInput: "git status",
      isAgentBusy: false,
    }),
    false,
  );
  assert.equal(
    shouldIgnoreTabAgentTrigger({
      input: "git status",
      lastTriggeredInput: undefined,
      isAgentBusy: true,
    }),
    true,
  );
});

test("beforeRun context is built from the pending command with git stats", async () => {
  const cwd = await createTempCwd();
  await recordGitCommandSuccess(cwd, "git status", new Date("2026-04-25T12:00:00.000Z"));
  await recordGitCommandSuccess(cwd, "git status --short", new Date("2026-04-25T12:01:00.000Z"));

  assert.deepEqual(await buildBeforeRunContext("git status --short", cwd), {
    cwd,
    command: "git",
    args: ["status", "--short"],
    rawCommand: "git status --short",
    gitStats: {
      successCount: 2,
      failures: [],
    },
  });
});

test("beforeRun context includes recent failures", async () => {
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

  assert.deepEqual(await buildBeforeRunContext("git push origin main", cwd), {
    cwd,
    command: "git",
    args: ["push", "origin", "main"],
    rawCommand: "git push origin main",
    gitStats: {
      successCount: 0,
      failures: [
        {
          count: 1,
          exitCode: 128,
          stdout: "",
          stderr: "fatal: rejected",
          occurredAt: "2026-04-25T12:05:00.000Z",
        },
      ],
    },
  });
});

test("beforeRun context includes current TUI session header state", async () => {
  const cwd = await createTempCwd();
  const session = {
    startedAt: "2026-04-26T09:00:00.000Z",
    cwd,
    git: {
      isRepository: true as const,
      root: cwd,
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
      isInstalled: true as const,
      isConnected: true as const,
      identity: "user",
      name: "Dong",
    },
  };

  assert.deepEqual(await buildBeforeRunContext("git status", cwd, session), {
    cwd,
    command: "git",
    args: ["status"],
    rawCommand: "git status",
    gitStats: {
      successCount: 0,
      failures: [],
    },
    tuiSession: {
      cwd,
      git: session.git,
      lark: session.lark,
      header: {
        cwd,
        gitSummary: "git: main abc1234 -> origin/main dirty S1 U2 ?3",
        larkSummary: "lark: connected user Dong",
        display: {
          cwd: formatTuiSessionCwdDisplay({
            cwd,
            git: session.git,
          }),
          git: [
            { text: "main", tone: "primary" },
            { text: "abc1234", tone: "muted" },
            { text: "origin/main", tone: "info" },
            { text: "已暂存 1", tone: "warning" },
            { text: "已修改 2", tone: "warning" },
            { text: "新文件 3", tone: "warning" },
          ],
          lark: [
            { text: "已连接", tone: "success" },
            { text: "user Dong", tone: "muted" },
          ],
        },
      },
    },
  });
});
