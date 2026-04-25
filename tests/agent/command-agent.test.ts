import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMAND_AGENT_SYSTEM_PROMPT,
  COMMAND_AGENT_TOOLS,
} from "../../src/agent/command-agent.js";

test("COMMAND_AGENT_TOOLS includes the tldr manual tool", () => {
  assert.equal(COMMAND_AGENT_TOOLS.length, 1);
  assert.equal(COMMAND_AGENT_TOOLS[0]?.name, "tldr_git_manual");
});

test("COMMAND_AGENT_SYSTEM_PROMPT asks for terminal-friendly output", () => {
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /输出要适合终端阅读/);
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /使用纯文本、短段落、短行和简单缩进/);
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /不要使用 Markdown 标题、表格、代码围栏、链接语法、复杂列表或终端控制字符/);
});

test("COMMAND_AGENT_SYSTEM_PROMPT describes git command stats", () => {
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /context\.gitStats\.successCount/);
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /context\.gitStats\.failures/);
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /count/);
});

test("COMMAND_AGENT_SYSTEM_PROMPT describes afterSuccess behavior", () => {
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /### afterSuccess/);
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /不要复述成功输出/);
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /push 后/);
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /commit 后/);
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /pull、merge、rebase 后/);
});

test("COMMAND_AGENT_SYSTEM_PROMPT describes commit message generation behavior", () => {
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /### generateCommitMessage/);
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /只输出一条 commit message/);
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /不要执行 git commit/);
  assert.match(COMMAND_AGENT_SYSTEM_PROMPT, /优先基于 stagedDiff/);
});
