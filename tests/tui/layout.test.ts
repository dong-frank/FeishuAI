import assert from "node:assert/strict";
import test from "node:test";

import {
  AppLayout,
  getLayoutHistoryRows,
  getPromptDisplayRows,
  getPromptViewportWidth,
  getSessionHeaderRows,
  formatHeaderLabelText,
  getHeaderChipColor,
  HISTORY_ROW_HEIGHT,
} from "../../src/tui/layout.js";
import { HistoryRowLine } from "../../src/tui/components.js";

test("session header rows build a three-line environment dashboard", () => {
  assert.deepEqual(
    getSessionHeaderRows({
      sessionHeader: {
        cwd: "/Users/dong/2026/feishuAI",
        gitSummary: "git: main 9f4aba1 -> origin/main dirty S0 U7 ?2",
        larkSummary: "lark: not logged in",
        display: {
          cwd: "/U/d/2/f/s/tui",
          git: [
            { text: "main", tone: "primary" },
            { text: "9f4aba1", tone: "muted" },
            { text: "origin/main", tone: "info" },
            { text: "已修改 7", tone: "warning" },
            { text: "新文件 2", tone: "warning" },
          ],
          lark: [{ text: "未登录", tone: "warning" }],
        },
      },
      isRunning: false,
    }),
    [
      {
        label: "brand",
        brand: "GITX",
      },
      {
        label: "git",
        git: [
          { text: "main", tone: "primary" },
          { text: "9f4aba1", tone: "muted" },
          { text: "origin/main", tone: "info" },
          { text: "已修改 7", tone: "warning" },
          { text: "新文件 2", tone: "warning" },
        ],
      },
      {
        label: "lark",
        lark: [{ text: "未登录", tone: "warning" }],
      },
    ],
  );
});

test("session header rows do not expose run state chips", () => {
  const sessionHeader = {
    cwd: "/repo",
    gitSummary: "git: main abc1234 clean",
    larkSummary: "lark: not logged in",
    display: {
      cwd: "~/repo",
      git: [{ text: "干净", tone: "success" }],
      lark: [{ text: "未登录", tone: "warning" }],
    },
  };
  const [idlePrimary] = getSessionHeaderRows({
    sessionHeader,
    isRunning: false,
  });
  const [runningPrimary] = getSessionHeaderRows({
    sessionHeader,
    isRunning: true,
  });

  assert.equal("status" in idlePrimary, false);
  assert.equal("status" in runningPrimary, false);
});

test("session header labels align separators by terminal display width", () => {
  assert.equal(formatHeaderLabelText("Git"), "Git  │ ");
  assert.equal(formatHeaderLabelText("飞书"), "飞书 │ ");
});

test("session header colors avoid overusing cyan", () => {
  assert.equal(getHeaderChipColor("primary"), "green");
  assert.equal(getHeaderChipColor("info"), "blue");
  assert.equal(getHeaderChipColor("warning"), "yellow");
  assert.equal(getHeaderChipColor("success"), "green");
  assert.equal(getHeaderChipColor("muted"), "gray");
});

test("session header leaves cwd for the prompt instead of a top status row", () => {
  const rows = getSessionHeaderRows({
    sessionHeader: {
      cwd: "/repo",
      gitSummary: "git: main abc1234 clean",
      larkSummary: "lark: connected user Dong",
      display: {
        cwd: "~/repo",
        git: [{ text: "干净", tone: "success" }],
        lark: [{ text: "已连接", tone: "success" }],
      },
    },
    isRunning: false,
  });

  assert.deepEqual(
    rows.map((row) => row.label),
    ["brand", "git", "lark"],
  );
});

test("layout history rows always fill the fixed viewport", () => {
  assert.deepEqual(
    getLayoutHistoryRows([{ text: "Agent", color: "cyan" }], 3),
    [{ text: "Agent", color: "cyan" }, { text: "" }, { text: "" }],
  );
  assert.deepEqual(
    getLayoutHistoryRows([{ text: "one" }, { text: "two" }, { text: "three" }], 2),
    [{ text: "one" }, { text: "two" }],
  );
});

test("history rows use a fixed line height inside the viewport", () => {
  assert.equal(HISTORY_ROW_HEIGHT, 1);
});

test("history row line pins command status to the right edge", () => {
  const row = HistoryRowLine({
    row: {
      text: "$ git status",
      color: "green",
      rightText: "[✓ 42ms]",
      rightColor: "green",
    },
  });

  assert.equal(row.props.justifyContent, "space-between");
  assert.equal(row.props.width, "100%");
  assert.equal(row.props.children[1].props.text, "[✓ 42ms]");
  assert.equal(row.props.children[1].props.color, "green");
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
    ['❯ git commit -m "fea', 't: 新增命令历史"'],
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

test("prompt display can include compact cwd like a terminal prompt", () => {
  const rows = getPromptDisplayRows({
    promptPrefix: "~/2/f/s/tui",
    beforeCursor: "git",
    cursor: " ",
    afterCursor: "status",
    completionSuffix: "",
  });

  assert.equal(
    rows[0]?.map((segment) => segment.text).join(""),
    "~/2/f/s/tui ❯ git status",
  );
});

test("history output keeps boundary lines without spacer rows around it", () => {
  const layout = AppLayout({
    sessionHeader: {
      cwd: "/repo",
      gitSummary: "git: main abc1234 clean",
      larkSummary: "lark: connected user Dong",
      display: {
        cwd: "repo",
        git: [
          { text: "main", tone: "primary" },
          { text: "abc1234", tone: "muted" },
          { text: "干净", tone: "success" },
        ],
        lark: [
          { text: "已连接", tone: "success" },
          { text: "user Dong", tone: "muted" },
        ],
      },
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
      display: {
        cwd: "repo",
        git: [
          { text: "main", tone: "primary" },
          { text: "abc1234", tone: "muted" },
          { text: "干净", tone: "success" },
        ],
        lark: [
          { text: "已连接", tone: "success" },
          { text: "user Dong", tone: "muted" },
        ],
      },
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
      isAgentReviewing: false,
    },
    viewportRows: 15,
  });

  assert.equal(layout.props.height, 15);
  assert.equal(layout.props.paddingY, undefined);
});
