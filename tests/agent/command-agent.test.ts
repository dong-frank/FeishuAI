import assert from "node:assert/strict";
import test from "node:test";

import {
  AFTER_FAIL_AGENT_SYSTEM_PROMPT,
  AFTER_SUCCESS_AGENT_SYSTEM_PROMPT,
  COMMIT_MESSAGE_AGENT_SYSTEM_PROMPT,
  COMMAND_AGENT_TOOLS,
  HELP_AGENT_SYSTEM_PROMPT,
} from "../../src/agent/command-agent.js";

test("COMMAND_AGENT_TOOLS includes the tldr manual tool", () => {
  assert.equal(COMMAND_AGENT_TOOLS.length, 1);
  assert.equal(COMMAND_AGENT_TOOLS[0]?.name, "tldr_git_manual");
});

test("HELP_AGENT_SYSTEM_PROMPT only describes command help behavior", () => {
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /命令帮助 Agent/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /tldr_git_manual/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /context\.gitStats\.successCount/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /context\.gitStats\.failures/);
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
  assert.doesNotMatch(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /afterSuccess/);
  assert.doesNotMatch(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /generateCommitMessage/);
});

test("COMMIT_MESSAGE_AGENT_SYSTEM_PROMPT only describes commit message generation", () => {
  assert.match(COMMIT_MESSAGE_AGENT_SYSTEM_PROMPT, /commit message 生成 Agent/);
  assert.match(COMMIT_MESSAGE_AGENT_SYSTEM_PROMPT, /只输出一条 commit message/);
  assert.match(COMMIT_MESSAGE_AGENT_SYSTEM_PROMPT, /不要执行 git commit/);
  assert.match(COMMIT_MESSAGE_AGENT_SYSTEM_PROMPT, /优先基于 stagedDiff/);
  assert.doesNotMatch(COMMIT_MESSAGE_AGENT_SYSTEM_PROMPT, /afterSuccess/);
  assert.doesNotMatch(COMMIT_MESSAGE_AGENT_SYSTEM_PROMPT, /askForHelp/);
});

test("all phase prompts keep terminal-friendly plain text output", () => {
  for (const prompt of [
    HELP_AGENT_SYSTEM_PROMPT,
    AFTER_SUCCESS_AGENT_SYSTEM_PROMPT,
    AFTER_FAIL_AGENT_SYSTEM_PROMPT,
    COMMIT_MESSAGE_AGENT_SYSTEM_PROMPT,
  ]) {
    assert.match(prompt, /输出要适合终端阅读/);
    assert.match(prompt, /不要使用 Markdown 标题、表格、代码围栏、链接语法/);
  }
});
