import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BEFORE_RUN_IDLE_MS,
  BEFORE_RUN_SUCCESS_SKIP_THRESHOLD,
  COMMIT_MESSAGE_IDLE_MS,
  buildBeforeRunContext,
  COMPLETION_GHOST_STYLE,
  CURSOR_STYLE,
  DEFAULT_AGENT_STATUS_WIDTH,
  TUI_USAGE_TIPS,
  getAgentStatusWidth,
  getNextEditableInput,
  getNextCommandHistoryInput,
  getOutputSections,
  getTuiMouseInputAction,
  getTuiMouseWheelAction,
  getPromptLineParts,
  getHistoryViewportHeight,
  getHistoryRows,
  getSessionHeaderParts,
  getStatusBarParts,
  getStatusLine,
  getNextHistoryScrollOffset,
  getVisibleHistoryRows,
  DEFAULT_STATUS_TEXT,
  getRenderedOutputText,
  getScrollingStatusText,
  getStatusPaneWidths,
  getTerminalTextWidth,
  INPUT_HISTORY_MARGIN_BOTTOM,
  isHelpOutput,
  getOutputTextParts,
  parseAnsiTextParts,
  shouldScheduleCommitMessageGeneration,
  shouldRefreshSessionAfterCommand,
  shouldShowClassificationLine,
  sanitizeTuiText,
  shouldScheduleBeforeRun,
  shouldTriggerBeforeRunForContext,
  WELCOME_SUBTITLE,
  WELCOME_TITLE,
} from "../../src/tui/app.js";
import {
  recordGitCommandFailure,
  recordGitCommandSuccess,
} from "../../src/runtime/git-command-stats.js";

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
  assert.ok(TUI_USAGE_TIPS.includes("输入 git commit -m 并停顿 2 秒可生成 commit message"));
  assert.ok(TUI_USAGE_TIPS.includes("完整 Git 命令停顿 5 秒后会请求 Agent 帮助"));
  assert.ok(TUI_USAGE_TIPS.includes("按 Up/Down 切换命令历史"));
  assert.ok(TUI_USAGE_TIPS.includes("按 PageUp/PageDown 滚动输出历史"));
});

test("welcome copy is split into prominent banner text", () => {
  assert.equal(WELCOME_TITLE, "Welcome to git-helper TUI");
  assert.equal(WELCOME_SUBTITLE, "Type a command, or type exit to quit.");
});

test("welcome copy scrolls as part of the history rows", () => {
  assert.deepEqual(getVisibleHistoryRows([], 4).map((row) => row.text), [
    WELCOME_TITLE,
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
    "按 Tab 补全命令或文件路径",
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
    "Command Agent：正在请求帮助 git status ...",
  );
  assert.equal(
    getStatusLine({
      isRunning: false,
      isAgentWaiting: true,
      agentKind: "lark",
      agentCommand: "lark init",
    }),
    "Lark Agent：正在处理 lark init ...",
  );
  assert.equal(
    getStatusLine({
      isRunning: false,
      isAgentWaiting: false,
      isBeforeRunPending: true,
      pendingCommand: "git status",
    }),
    "Agent：等待触发 git status",
  );
  assert.equal(
    getStatusLine({
      isRunning: true,
      isAgentWaiting: true,
      agentKind: "command",
      agentCommand: "git status",
    }),
    "Command Agent：正在请求帮助 git status ...",
  );
  assert.equal(
    getStatusLine({
      isRunning: false,
      isAgentWaiting: false,
      isCommitMessageGenerating: true,
      agentKind: "command",
      agentCommand: "git commit -m",
    }),
    "Command Agent：正在生成提交信息 git commit -m ...",
  );
  assert.equal(
    getStatusLine({
      isRunning: false,
      isAgentWaiting: false,
      isAgentReviewing: true,
      agentKind: "command",
      agentCommand: "git push",
    }),
    "Command Agent：正在检查 git push ...",
  );
});

test("status bar keeps usage tips on the left and agent state on the right", () => {
  assert.deepEqual(
    getStatusBarParts({
      isRunning: false,
      isAgentWaiting: false,
      tipIndex: 1,
    }),
    {
      left: "按 Tab 补全命令或文件路径",
      right: "Agent：空闲",
    },
  );
  assert.deepEqual(
    getStatusBarParts({
      isRunning: false,
      isAgentWaiting: false,
      isCommitMessageGenerating: true,
      agentKind: "command",
      agentCommand: "git commit -m",
      tipIndex: 1,
    }),
    {
      left: "按 Tab 补全命令或文件路径",
      right: "Command Agent：正在生成提...",
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
      left: "按 Tab 补全命令或文件路径",
      right: "Lark Agent：正在处理 lark...",
    },
  );
});

test("agent status uses a bounded viewport and scrolls long text with ellipsis", () => {
  assert.equal(DEFAULT_AGENT_STATUS_WIDTH, 28);
  assert.equal(getAgentStatusWidth(undefined), DEFAULT_AGENT_STATUS_WIDTH);
  assert.deepEqual(getStatusPaneWidths(undefined), { left: 28, right: 28 });
  assert.deepEqual(getStatusPaneWidths(40), { left: 14, right: 14 });
  assert.deepEqual(getStatusPaneWidths(120), { left: 54, right: 54 });
  assert.equal(getAgentStatusWidth(40), 14);
  assert.equal(getAgentStatusWidth(120), 54);
  assert.equal(getTerminalTextWidth("Agent：空闲"), 11);
  assert.equal(getTerminalTextWidth("按 Tab 补全命令或文件路径"), 25);

  assert.equal(
    getScrollingStatusText({
      text: "Agent：空闲",
      width: 24,
      offset: 10,
    }),
    "Agent：空闲",
  );
  assert.equal(
    getScrollingStatusText({
      text: "Agent：正在请求帮助 git commit --amend --no-edit --verbose ...",
      width: 24,
      offset: 0,
    }),
    "Agent：正在请求帮助 g...",
  );
  assert.equal(
    getScrollingStatusText({
      text: "Agent：正在请求帮助 git commit --amend --no-edit --verbose ...",
      width: 24,
      offset: 10,
    }),
    "...在请求帮助 git com...",
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
      left: "...nter 执...",
      right: "...ent：正在请求帮助 ...",
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

test("beforeRun waits for five idle seconds", () => {
  assert.equal(BEFORE_RUN_IDLE_MS, 5000);
  assert.equal(BEFORE_RUN_SUCCESS_SKIP_THRESHOLD, 3);
});

test("beforeRun schedules only for complete idle commands", () => {
  assert.equal(
    shouldScheduleBeforeRun({
      input: "git status",
      completionSuffix: undefined,
      isRunning: false,
    }),
    true,
  );
  assert.equal(
    shouldScheduleBeforeRun({
      input: "git sta",
      completionSuffix: "tus",
      isRunning: false,
    }),
    false,
  );
  assert.equal(
    shouldScheduleBeforeRun({
      input: "git pu",
      completionSuffix: undefined,
      isRunning: false,
    }),
    false,
  );
  assert.equal(
    shouldScheduleBeforeRun({
      input: "git status ?",
      completionSuffix: undefined,
      isRunning: false,
    }),
    false,
  );
  assert.equal(
    shouldScheduleBeforeRun({
      input: "git status",
      completionSuffix: undefined,
      isRunning: true,
    }),
    false,
  );
  assert.equal(
    shouldScheduleBeforeRun({
      input: "node -v",
      completionSuffix: undefined,
      isRunning: false,
    }),
    false,
  );
});

test("commit message generation schedules only for idle git commit -m", () => {
  assert.equal(COMMIT_MESSAGE_IDLE_MS, 2000);
  assert.equal(
    shouldScheduleCommitMessageGeneration({
      input: "git commit -m",
      completionSuffix: undefined,
      isRunning: false,
    }),
    true,
  );
  assert.equal(
    shouldScheduleCommitMessageGeneration({
      input: "git commit -m \"message\"",
      completionSuffix: undefined,
      isRunning: false,
    }),
    false,
  );
  assert.equal(
    shouldScheduleCommitMessageGeneration({
      input: 'git commit -m "',
      completionSuffix: undefined,
      isRunning: false,
    }),
    false,
  );
  assert.equal(
    shouldScheduleCommitMessageGeneration({
      input: "git commit",
      completionSuffix: undefined,
      isRunning: false,
    }),
    false,
  );
  assert.equal(
    shouldScheduleCommitMessageGeneration({
      input: "git commit -m",
      completionSuffix: "essage",
      isRunning: false,
    }),
    false,
  );
});

test("beforeRun skips idle help after enough successful runs", () => {
  assert.equal(
    shouldTriggerBeforeRunForContext({
      cwd: "/repo",
      command: "git",
      args: ["status"],
      rawCommand: "git status",
      gitStats: {
        successCount: 2,
        failures: [],
      },
    }),
    true,
  );
  assert.equal(
    shouldTriggerBeforeRunForContext({
      cwd: "/repo",
      command: "git",
      args: ["status"],
      rawCommand: "git status",
      gitStats: {
        successCount: 3,
        failures: [],
      },
    }),
    false,
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
