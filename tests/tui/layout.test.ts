import assert from "node:assert/strict";
import test from "node:test";

import {
  AppLayout,
  getLayoutHistoryRows,
  getPromptDisplayRows,
  getPromptViewportWidth,
  getSessionHeaderRows,
  HISTORY_ROW_HEIGHT,
} from "../../src/tui/layout.js";

test("session header rows split cwd, git, and lark status across three lines", () => {
  assert.deepEqual(
    getSessionHeaderRows({
      sessionHeader: {
        cwd: "/Users/dong/2026/feishuAI",
        gitSummary: "git: main 9f4aba1 -> origin/main dirty S0 U7 ?2",
        larkSummary: "lark: not logged in",
      },
      isRunning: false,
    }),
    [
      {
        label: "cwd",
        text: "/Users/dong/2026/feishuAI",
        status: "ready",
        brand: "git-helper",
      },
      {
        label: "git",
        text: "main 9f4aba1 -> origin/main dirty S0 U7 ?2",
      },
      {
        label: "lark",
        text: "not logged in",
      },
    ],
  );
});

test("layout history rows always fill the fixed viewport", () => {
  assert.deepEqual(
    getLayoutHistoryRows([{ text: "Agent help", color: "cyan" }], 3),
    [{ text: "Agent help", color: "cyan" }, { text: "" }, { text: "" }],
  );
  assert.deepEqual(
    getLayoutHistoryRows([{ text: "one" }, { text: "two" }, { text: "three" }], 2),
    [{ text: "one" }, { text: "two" }],
  );
});

test("history rows use a fixed line height inside the viewport", () => {
  assert.equal(HISTORY_ROW_HEIGHT, 1);
});

test("prompt display wraps long input while preserving cursor styling segment", () => {
  assert.equal(getPromptViewportWidth(30), 24);

  const rows = getPromptDisplayRows(
    {
      beforeCursor: 'git commit -m "feat: 新增',
      cursor: "命",
      afterCursor: '令历史"',
      completionSuffix: "",
    },
    20,
  );

  assert.deepEqual(
    rows.map((row) => row.map((segment) => segment.text).join("")),
    ['$ git commit -m "fea', 't: 新增命令历史"'],
  );
  assert.deepEqual(
    rows[1],
    [
      { kind: "input", text: "t: 新增" },
      { kind: "cursor", text: "命" },
      { kind: "input", text: '令历史"' },
    ],
  );
});

test("history output keeps boundary lines without spacer rows around it", () => {
  const layout = AppLayout({
    sessionHeader: {
      cwd: "/repo",
      gitSummary: "git: main abc1234 clean",
      larkSummary: "lark: connected user Dong",
    },
    isRunning: false,
    historyViewportHeight: 2,
    visibleHistoryRows: [{ text: "first" }, { text: "second" }],
    promptLine: {
      beforeCursor: "",
      cursor: " ",
      afterCursor: "",
      completionSuffix: "",
    },
    statusPaneWidths: {
      left: 20,
      right: 20,
    },
    statusState: {
      isRunning: false,
      isAgentWaiting: false,
      isCommitMessageGenerating: false,
      isAgentReviewing: false,
    },
    viewportRows: 15,
  });

  const root = layout.props.children;
  const header = root.props.children[0];
  const historyPanel = root.props.children[1];
  const prompt = root.props.children[2];

  assert.equal(root.props.borderStyle, undefined);
  assert.equal(header.props.marginBottom, undefined);
  assert.equal(historyPanel.props.height, 2);
  assert.equal(prompt.props.marginTop, undefined);
});

test("layout pins fixed chrome to the terminal height", () => {
  const layout = AppLayout({
    sessionHeader: {
      cwd: "/repo",
      gitSummary: "git: main abc1234 clean",
      larkSummary: "lark: connected user Dong",
    },
    isRunning: false,
    historyViewportHeight: 0,
    visibleHistoryRows: [],
    promptLine: {
      beforeCursor: "",
      cursor: " ",
      afterCursor: "",
      completionSuffix: "",
    },
    statusPaneWidths: {
      left: 20,
      right: 20,
    },
    statusState: {
      isRunning: false,
      isAgentWaiting: false,
      isCommitMessageGenerating: false,
      isAgentReviewing: false,
    },
    viewportRows: 15,
  });

  assert.equal(layout.props.height, 15);
  assert.equal(layout.props.paddingY, undefined);
});
