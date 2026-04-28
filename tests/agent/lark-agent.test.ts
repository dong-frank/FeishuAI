import assert from "node:assert/strict";
import test from "node:test";

import {
  formatLarkAgentInvocation,
  createRunLarkCliTool,
  LARK_AGENT_SYSTEM_PROMPT,
  LARK_AGENT_TASK_SKILLS,
  LARK_AGENT_TOOLS,
} from "../../src/agent/lark-agent.js";

test("lark agent exposes load_skill and run_lark_cli tools", () => {
  assert.deepEqual(
    LARK_AGENT_TOOLS.map((tool) => tool.name),
    ["load_skill", "run_lark_cli"],
  );
});

test("lark agent exposes only controlled task to skill mappings", () => {
  assert.deepEqual(LARK_AGENT_TASK_SKILLS, {
    authorize: "lark-authorize",
    getContext: "lark-doc-lookup",
    sendMessage: "lark-im",
  });
});

test("formatLarkAgentInvocation builds task envelopes with fixed skills", () => {
  assert.equal(
    formatLarkAgentInvocation("getContext", {
      cwd: "/repo",
      topic: "commit_message_policy",
      reason: "generate_commit_message",
    }),
    JSON.stringify({
      task: "getContext",
      skill: "lark-doc-lookup",
      context: {
        cwd: "/repo",
        topic: "commit_message_policy",
        reason: "generate_commit_message",
      },
    }),
  );
});

test("single lark prompt describes phase behavior and skill loading", () => {
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /单一飞书 Agent/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /load_skill/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /run_lark_cli/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /showOutputInTui/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /默认 false/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /需要用户扫码、打开链接、等待交互完成/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /输出本身就是用户需要直接查看的结果/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /--format pretty/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /--format table/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /--format ndjson/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /--format csv/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /--format json/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /authorize/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /getContext/);
  assert.doesNotMatch(LARK_AGENT_SYSTEM_PROMPT, /requestContext/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /commit_message_policy/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /troubleshooting_reference/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /团队 commit message 规范/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /团队排障参考/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /同一个 topic/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /不要把 commit 规范当作排障方法/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /不要把排障资料当作 commit 规范/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /remembered/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /refreshed/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /missing/);
  assert.doesNotMatch(LARK_AGENT_SYSTEM_PROMPT, /searchDocs/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /sendMessage/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /lark-authorize/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /lark-doc-lookup/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /lark-im/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /受控 task/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /固定 Skill/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /不要根据 context/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /不要接受或执行 CLI args/);
  assert.doesNotMatch(LARK_AGENT_SYSTEM_PROMPT, /docs", "\+search/);
  assert.doesNotMatch(LARK_AGENT_SYSTEM_PROMPT, /docs", "\+fetch/);
  assert.doesNotMatch(LARK_AGENT_SYSTEM_PROMPT, /im", "\+messages-send/);
  assert.doesNotMatch(LARK_AGENT_SYSTEM_PROMPT, /config", "init/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /不要编造/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /输出要适合终端阅读/);
});

test("run_lark_cli only forwards output to TUI history when requested", async () => {
  const calls: Array<{ args: string[]; hasOutputCallback: boolean }> = [];
  const chunks: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
  const tool = createRunLarkCliTool({
    onLarkCliOutput(chunk) {
      chunks.push(chunk);
    },
    runLarkCli: async (args, options = {}) => {
      calls.push({ args, hasOutputCallback: Boolean(options.onOutput) });
      options.onOutput?.({ stream: "stdout", text: "authorize link\n" });
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
  });

  await tool.invoke({ args: ["auth", "status"], showOutputInTui: false });
  await tool.invoke({
    args: ["auth", "login", "--recommend"],
    showOutputInTui: true,
  });

  assert.deepEqual(calls, [
    { args: ["auth", "status"], hasOutputCallback: false },
    { args: ["auth", "login", "--recommend"], hasOutputCallback: true },
  ]);
  assert.deepEqual(chunks, [{ stream: "stdout", text: "authorize link\n" }]);
});
