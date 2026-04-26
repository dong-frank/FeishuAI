import assert from "node:assert/strict";
import test from "node:test";

import {
  getLayoutHistoryRows,
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
