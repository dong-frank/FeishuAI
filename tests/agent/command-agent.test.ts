import assert from "node:assert/strict";
import test from "node:test";

import {
  AFTER_FAIL_AGENT_SYSTEM_PROMPT,
  AFTER_SUCCESS_AGENT_SYSTEM_PROMPT,
  buildGitCommitContext,
  COMMAND_AGENT_PROVIDER_RESPONSE_FORMAT,
  COMMAND_AGENT_RESPONSE_FORMAT,
  COMMAND_AGENT_TOOLS,
  GIT_COMMIT_CONTEXT_DIFF_LIMIT,
  GIT_COMMIT_CONTEXT_SUMMARY_LIMIT,
  HELP_AGENT_SYSTEM_PROMPT,
  parseCommandAgentOutput,
} from "../../src/agent/command-agent.js";

test("COMMAND_AGENT_TOOLS includes help and git commit context tools", () => {
  assert.deepEqual(
    COMMAND_AGENT_TOOLS.map((tool) => tool.name),
    ["tldr_git_manual", "git_commit_context"],
  );
});

test("command agent structured output defaults to native provider schema", () => {
  assert.equal(COMMAND_AGENT_RESPONSE_FORMAT, COMMAND_AGENT_PROVIDER_RESPONSE_FORMAT);
  assert.equal(Array.isArray(COMMAND_AGENT_RESPONSE_FORMAT), false);
});

test("HELP_AGENT_SYSTEM_PROMPT only describes command help behavior", () => {
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /命令帮助 Agent/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /tldr_git_manual/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /context\.gitStats\.successCount/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /context\.gitStats\.failures/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /context\.tuiSession/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /header\.gitSummary/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /header\.larkSummary/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /git commit/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /git_commit_context/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /git commit -m/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /历史画像/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /当前工作区状态/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /不要把 gitStats\.failures/);
  assert.doesNotMatch(HELP_AGENT_SYSTEM_PROMPT, /afterSuccess/);
  assert.doesNotMatch(HELP_AGENT_SYSTEM_PROMPT, /generateCommitMessage/);
});

test("AFTER_SUCCESS_AGENT_SYSTEM_PROMPT only describes after-success behavior", () => {
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /成功后建议 Agent/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /不要复述成功输出/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /push 后/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /commit 后/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /pull、merge、rebase 后/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /context\.gitRepository/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /branch、upstream 和 dirty/);
  assert.doesNotMatch(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /tldr_git_manual/);
  assert.doesNotMatch(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /generateCommitMessage/);
});

test("AFTER_FAIL_AGENT_SYSTEM_PROMPT only describes failure behavior", () => {
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /失败后辅助 Agent/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /result\.exitCode/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /result\.stderr/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /排查方向或下一步命令/);
  assert.doesNotMatch(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /afterSuccess/);
  assert.doesNotMatch(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /generateCommitMessage/);
});

test("all phase prompts keep terminal-friendly plain text output", () => {
  for (const prompt of [
    HELP_AGENT_SYSTEM_PROMPT,
    AFTER_SUCCESS_AGENT_SYSTEM_PROMPT,
    AFTER_FAIL_AGENT_SYSTEM_PROMPT,
  ]) {
    assert.match(prompt, /输出要适合终端阅读/);
    assert.match(prompt, /不要使用 Markdown 标题、表格、代码围栏、链接语法/);
    assert.match(prompt, /content/);
    assert.match(prompt, /suggestedCommand/);
  }
});

test("parseCommandAgentOutput parses structured JSON output", () => {
  assert.deepEqual(
    parseCommandAgentOutput(
      '{"content":"执行 git status 查看状态","suggestedCommand":"git status --short"}',
    ),
    {
      content: "执行 git status 查看状态",
      suggestedCommand: "git status --short",
    },
  );
});

test("parseCommandAgentOutput falls back to plain text content", () => {
  assert.deepEqual(parseCommandAgentOutput("执行 git status 查看状态"), {
    content: "执行 git status 查看状态",
  });
});

test("parseCommandAgentOutput trims output and ignores blank suggested command", () => {
  assert.deepEqual(
    parseCommandAgentOutput('  {"content":"  msg  ","suggestedCommand":"   "}  '),
    {
      content: "msg",
    },
  );
});

test("parseCommandAgentOutput validates structured JSON shape before accepting it", () => {
  assert.deepEqual(
    parseCommandAgentOutput(
      '{"content":"msg","suggestedCommand":"git status","extra":"ignored?"}',
    ),
    {
      content:
        '{"content":"msg","suggestedCommand":"git status","extra":"ignored?"}',
    },
  );
  assert.deepEqual(parseCommandAgentOutput('{"content":123,"suggestedCommand":"git status"}'), {
    content: '{"content":123,"suggestedCommand":"git status"}',
  });
});

test("buildGitCommitContext runs fixed git commands", async () => {
  const calls: string[][] = [];
  const context = await buildGitCommitContext({
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
    status: {
      command: "git status --short",
      exitCode: 0,
      stdout: "M  src/app.tsx",
      stderr: "",
      truncated: false,
    },
    stagedDiff: {
      command: "git diff --cached",
      exitCode: 0,
      stdout: "cached diff",
      stderr: "",
      truncated: false,
    },
    unstagedDiff: {
      command: "git diff",
      exitCode: 0,
      stdout: "unstaged diff",
      stderr: "",
      truncated: false,
    },
    recentCommits: {
      command: "git log -5 --pretty=%s",
      exitCode: 0,
      stdout: "feat: add tui\nfix: status",
      stderr: "",
      truncated: false,
      subjects: ["feat: add tui", "fix: status"],
    },
  });
});

test("buildGitCommitContext truncates large git outputs", async () => {
  const longDiff = "d".repeat(GIT_COMMIT_CONTEXT_DIFF_LIMIT + 10);
  const longStatus = "s".repeat(GIT_COMMIT_CONTEXT_SUMMARY_LIMIT + 10);
  assert.equal(GIT_COMMIT_CONTEXT_DIFF_LIMIT, 3000);
  assert.equal(GIT_COMMIT_CONTEXT_SUMMARY_LIMIT, 1000);
  const context = await buildGitCommitContext({
    cwd: "/repo",
    runGitCommand(args) {
      const command = args.join(" ");
      if (command === "status --short") {
        return Promise.resolve({ exitCode: 0, stdout: longStatus, stderr: "" });
      }
      if (command === "log -5 --pretty=%s") {
        return Promise.resolve({ exitCode: 0, stdout: longStatus, stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: longDiff, stderr: "" });
    },
  });

  assert.equal(context.status.stdout.length, GIT_COMMIT_CONTEXT_SUMMARY_LIMIT);
  assert.equal(context.status.truncated, true);
  assert.equal(context.stagedDiff.stdout.length, GIT_COMMIT_CONTEXT_DIFF_LIMIT);
  assert.equal(context.stagedDiff.truncated, true);
  assert.equal(context.unstagedDiff.stdout.length, GIT_COMMIT_CONTEXT_DIFF_LIMIT);
  assert.equal(context.unstagedDiff.truncated, true);
  assert.equal(context.recentCommits.stdout.length, GIT_COMMIT_CONTEXT_SUMMARY_LIMIT);
  assert.equal(context.recentCommits.truncated, true);
});
