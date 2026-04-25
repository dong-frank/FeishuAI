import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCommitMessageContext,
  quoteCommitMessageForShell,
} from "../../src/runtime/commit-message-context.js";

test("buildCommitMessageContext collects git status, diffs, and recent commit subjects", async () => {
  const calls: string[][] = [];

  const context = await buildCommitMessageContext({
    cwd: "/repo",
    runGitCommand(args) {
      calls.push(args);
      const command = args.join(" ");
      if (command === "status --short") {
        return Promise.resolve({ exitCode: 0, stdout: "M  src/app.tsx\n", stderr: "" });
      }
      if (command === "diff --cached") {
        return Promise.resolve({ exitCode: 0, stdout: "cached diff", stderr: "" });
      }
      if (command === "diff") {
        return Promise.resolve({ exitCode: 0, stdout: "unstaged diff", stderr: "" });
      }
      if (command === "log -5 --pretty=%s") {
        return Promise.resolve({ exitCode: 0, stdout: "feat: add tui\nfix: status\n", stderr: "" });
      }

      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    },
  });

  assert.deepEqual(calls, [
    ["status", "--short"],
    ["diff", "--cached"],
    ["diff"],
    ["log", "-5", "--pretty=%s"],
  ]);
  assert.deepEqual(context, {
    cwd: "/repo",
    status: "M  src/app.tsx",
    stagedDiff: "cached diff",
    unstagedDiff: "unstaged diff",
    recentCommits: ["feat: add tui", "fix: status"],
  });
});

test("quoteCommitMessageForShell wraps and escapes generated commit messages", () => {
  assert.equal(quoteCommitMessageForShell("feat: add TUI"), '"feat: add TUI"');
  assert.equal(
    quoteCommitMessageForShell('fix: handle "quotes" and $vars'),
    '"fix: handle \\"quotes\\" and \\$vars"',
  );
});
