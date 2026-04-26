import assert from "node:assert/strict";
import test from "node:test";

import {
  LARK_AUTH_AGENT_SYSTEM_PROMPT,
  LARK_AUTH_AGENT_TOOLS,
  LARK_AGENT_SYSTEM_PROMPT_PREFIX,
  LARK_DOC_SEARCH_AGENT_SYSTEM_PROMPT,
  LARK_DOC_SEARCH_AGENT_TOOLS,
  LARK_MESSAGE_AGENT_SYSTEM_PROMPT,
  LARK_MESSAGE_AGENT_TOOLS,
} from "../../src/agent/lark-agent.js";

test("all lark phases include the generic run_lark_cli tool", () => {
  assert.deepEqual(
    LARK_AUTH_AGENT_TOOLS.map((tool) => tool.name),
    ["run_lark_cli"],
  );
  assert.deepEqual(
    LARK_DOC_SEARCH_AGENT_TOOLS.map((tool) => tool.name),
    ["run_lark_cli"],
  );
  assert.deepEqual(
    LARK_MESSAGE_AGENT_TOOLS.map((tool) => tool.name),
    ["run_lark_cli"],
  );
});

test("lark phase prompts describe separate terminal-friendly behavior", () => {
  assert.match(LARK_AGENT_SYSTEM_PROMPT_PREFIX, /按照以下给出的 Skill 内容进行操作/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT_PREFIX, /唯一可用的工具是 RUN_LARK_CLI_TOOL/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT_PREFIX, /工具名为 run_lark_cli/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT_PREFIX, /只传 args 数组/);
  for (const prompt of [
    LARK_AUTH_AGENT_SYSTEM_PROMPT,
    LARK_DOC_SEARCH_AGENT_SYSTEM_PROMPT,
    LARK_MESSAGE_AGENT_SYSTEM_PROMPT,
  ]) {
    assert.ok(prompt.startsWith(LARK_AGENT_SYSTEM_PROMPT_PREFIX));
  }

  assert.match(LARK_AUTH_AGENT_SYSTEM_PROMPT, /# lark-cli 共享规则/);
  assert.match(LARK_AUTH_AGENT_SYSTEM_PROMPT, /配置初始化/);
  assert.match(LARK_AUTH_AGENT_SYSTEM_PROMPT, /身份类型/);
  assert.match(LARK_AUTH_AGENT_SYSTEM_PROMPT, /权限不足处理/);
  assert.match(LARK_AUTH_AGENT_SYSTEM_PROMPT, /禁止输出密钥/);
  assert.match(LARK_AUTH_AGENT_SYSTEM_PROMPT, /可以通过 Agent 工具发起该交互式流程/);
  assert.match(LARK_AUTH_AGENT_SYSTEM_PROMPT, /命令运行期间 TUI 会实时显示/);
  assert.match(LARK_AUTH_AGENT_SYSTEM_PROMPT, /工具才返回完整结果/);

  assert.match(LARK_DOC_SEARCH_AGENT_SYSTEM_PROMPT, /搜索飞书文档阶段 Agent/);
  assert.match(LARK_DOC_SEARCH_AGENT_SYSTEM_PROMPT, /run_lark_cli/);
  assert.match(LARK_DOC_SEARCH_AGENT_SYSTEM_PROMPT, /docs", "\+search/);
  assert.match(LARK_DOC_SEARCH_AGENT_SYSTEM_PROMPT, /docs", "\+fetch/);

  assert.match(LARK_MESSAGE_AGENT_SYSTEM_PROMPT, /发送飞书消息阶段 Agent/);
  assert.match(LARK_MESSAGE_AGENT_SYSTEM_PROMPT, /run_lark_cli/);
  assert.match(LARK_MESSAGE_AGENT_SYSTEM_PROMPT, /im", "\+messages-send/);

  for (const prompt of [
    LARK_DOC_SEARCH_AGENT_SYSTEM_PROMPT,
    LARK_MESSAGE_AGENT_SYSTEM_PROMPT,
  ]) {
    assert.match(prompt, /不要编造/);
    assert.match(prompt, /输出要适合终端阅读/);
  }
});
