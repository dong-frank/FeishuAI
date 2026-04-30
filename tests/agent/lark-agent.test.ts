import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { FakeListChatModel } from "@langchain/core/utils/testing";
import { ChatOpenAI } from "@langchain/openai";

import {
  compactLarkAgentHistoryEntry,
  createLarkAgent,
  formatLarkAgentInvocation,
  createRunLarkCliTool,
  LARK_AGENT_INTERACTION_SKILLS,
  LARK_AGENT_SYSTEM_PROMPT,
  LARK_AGENT_TASK_SKILLS,
  LARK_AGENT_TOOLS,
  parseLarkInteractionResult,
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
  });
  assert.deepEqual(LARK_AGENT_INTERACTION_SKILLS, {
    get_context: "lark-doc-lookup",
    send_message: "lark-im",
    write_development_record: "lark-doc-write",
  });
});

test("formatLarkAgentInvocation builds task envelopes with fixed skills", () => {
  assert.equal(
    formatLarkAgentInvocation("interact", {
      action: "get_context",
      cwd: "/repo",
      topic: "commit_message_policy",
      reason: "generate_commit_message",
    }),
    JSON.stringify({
      task: "interact",
      skill: "lark-doc-lookup",
      context: {
        action: "get_context",
        cwd: "/repo",
        topic: "commit_message_policy",
        reason: "generate_commit_message",
      },
    }),
  );

  assert.equal(
    formatLarkAgentInvocation("interact", {
      action: "write_development_record",
      cwd: "/repo",
      reason: "after_success_git_push",
      command: "git",
      rawCommand: "git push",
      result: {
        exitCode: 0,
        stdout: "To github.com:acme/repo.git\n",
        stderr: "",
      },
    }),
    JSON.stringify({
      task: "interact",
      skill: "lark-doc-write",
      context: {
        action: "write_development_record",
        cwd: "/repo",
        reason: "after_success_git_push",
        command: "git",
        rawCommand: "git push",
        result: {
          exitCode: 0,
          stdout: "To github.com:acme/repo.git\n",
          stderr: "",
        },
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
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /interact/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /get_context/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /write_development_record/);
  assert.doesNotMatch(LARK_AGENT_SYSTEM_PROMPT, /requestContext/);
  assert.doesNotMatch(LARK_AGENT_SYSTEM_PROMPT, /getContext/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /commit_message_policy/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /troubleshooting_reference/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /团队 commit message 规范/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /团队排障参考/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /团队开发记录文档/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /project_context_index/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /优先从 project_context_index/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /索引缺失/);
  assert.doesNotMatch(LARK_AGENT_SYSTEM_PROMPT, /## authorize 项目知识预热/);
  assert.doesNotMatch(LARK_AGENT_SYSTEM_PROMPT, /project_context_index 必须包含/);
  assert.doesNotMatch(LARK_AGENT_SYSTEM_PROMPT, /development_record、review_process、requirements_status、ci_cd/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /同一个 topic/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /不要把 commit 规范当作排障方法/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /不要把排障资料当作 commit 规范/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /remembered/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /refreshed/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /missing/);
  assert.doesNotMatch(LARK_AGENT_SYSTEM_PROMPT, /searchDocs/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /send_message/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /lark-authorize/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /lark-doc-lookup/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /lark-im/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /lark-doc-write/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /受控 task/);
  assert.match(LARK_AGENT_SYSTEM_PROMPT, /受控 action/);
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

test("lark authorize skill warms project context with read-only docs commands", () => {
  const skill = readFileSync(
    join(process.cwd(), "skills", "lark-authorize", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /Step 5: Project Knowledge Warmup/);
  assert.match(skill, /project_context_index/);
  assert.match(skill, /project：项目名或仓库名/);
  assert.match(skill, /knowledgeBase：知识库名称/);
  assert.match(skill, /documents：所有可读文档节点/);
  assert.match(skill, /outlines：docx\/doc 文档的轻量目录/);
  assert.match(skill, /coverage：已遍历范围/);
  assert.match(skill, /retrievalHints：后续查询时可按标题/);
  assert.match(skill, /项目对应知识库/);
  assert.match(skill, /遍历/);
  assert.match(skill, /所有可读/);
  assert.match(skill, /不要只按固定主题/);
  assert.match(skill, /全量目录索引/);
  assert.match(skill, /docs \+search/);
  assert.match(skill, /docs \+fetch/);
  assert.match(skill, /wiki spaces get_node/);
  assert.match(skill, /wiki nodes list/);
  assert.doesNotMatch(skill, /最多选择 3 到 5 个/);
  assert.doesNotMatch(skill, /优先覆盖这些主题/);
  assert.match(skill, /禁止/);
  assert.match(skill, /docs \+create/);
  assert.match(skill, /docs \+update/);
});

test("lark doc lookup distinguishes docs search from wiki browsing", () => {
  const skill = readFileSync(
    join(process.cwd(), "skills", "lark-doc-lookup", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /docs \+search/);
  assert.match(skill, /资源发现/);
  assert.match(skill, /wiki spaces get_node/);
  assert.match(skill, /wiki nodes list/);
  assert.match(skill, /project_context_index/);
  assert.match(skill, /全量目录索引/);
  assert.match(skill, /不要只依赖固定 topic/);
  assert.match(skill, /obj_type/);
  assert.match(skill, /obj_token/);
  assert.match(skill, /docx\/doc/);
  assert.match(skill, /sheet/);
  assert.match(skill, /bitable/);
  assert.match(skill, /不要把 wiki token 直接当成 doc token/);
  assert.match(skill, /禁止/);
  assert.match(skill, /wiki \+node-create/);
  assert.match(skill, /wiki \+move/);
});

test("parseLarkInteractionResult keeps get_context structured packs", () => {
  assert.deepEqual(
    parseLarkInteractionResult(
      {
        action: "get_context",
        cwd: "/repo",
        topic: "commit_message_policy",
        reason: "generate_commit_message",
      },
      JSON.stringify({
        topic: "commit_message_policy",
        content: "团队使用 conventional commits。",
        freshness: "refreshed",
      }),
    ),
    {
      topic: "commit_message_policy",
      content: "团队使用 conventional commits。",
      freshness: "refreshed",
    },
  );
});

test("parseLarkInteractionResult returns command output for write_development_record", () => {
  assert.deepEqual(
    parseLarkInteractionResult(
      {
        action: "write_development_record",
        cwd: "/repo",
        reason: "after_success_git_push",
      },
      JSON.stringify({
        content: "已写入团队开发记录：研发记录 / repo",
      }),
    ),
    {
      content: "已写入团队开发记录：研发记录 / repo",
    },
  );
});

test("lark agent compacts preserved history to task, action, topic, and reply", async () => {
  const repeatedRuntimeContext = "LARK_RUNTIME_CONTEXT_SHOULD_NOT_BE_REMEMBERED".repeat(80);
  const agent = createLarkAgent({
    model: new FakeListChatModel({
      responses: [
        JSON.stringify({ content: "auth ready" }),
      ],
    }) as unknown as ChatOpenAI,
    skillRegistry: {
      listSkills() {
        return [];
      },
      loadSkill(name: string) {
        return Promise.resolve(`skill:${name}`);
      },
    },
    runLarkCli: async () => ({
      exitCode: 0,
      stdout: repeatedRuntimeContext,
      stderr: repeatedRuntimeContext,
    }),
  });

  const authorizeOutput = await agent.authorize({
    cwd: "/repo",
    intent: repeatedRuntimeContext,
    projectHints: {
      cwdName: "repo",
      gitRoot: "/repo",
      branch: "main",
      remoteUrl: repeatedRuntimeContext,
      webUrl: repeatedRuntimeContext,
      repositoryName: "repo",
    },
  });
  const compactAuthorizeHistory = compactLarkAgentHistoryEntry(
    formatLarkAgentInvocation("authorize", {
      cwd: "/repo",
      intent: repeatedRuntimeContext,
      projectHints: {
        cwdName: "repo",
        gitRoot: "/repo",
        branch: "main",
        remoteUrl: repeatedRuntimeContext,
        webUrl: repeatedRuntimeContext,
        repositoryName: "repo",
      },
    }),
    JSON.stringify({ content: "auth ready" }),
  );
  const compactContextHistory = compactLarkAgentHistoryEntry(
    formatLarkAgentInvocation("interact", {
      action: "get_context",
      cwd: "/repo",
      topic: "commit_message_policy",
      reason: repeatedRuntimeContext,
      command: "git",
      rawCommand: "git commit",
      repository: {
        root: "/repo",
        remoteUrl: repeatedRuntimeContext,
        webUrl: repeatedRuntimeContext,
      },
    }),
    JSON.stringify({
      topic: "commit_message_policy",
      content: "团队使用 conventional commits。",
      freshness: "refreshed",
      source: {
        title: "FlowDesk Git 协作规范",
        url: "https://example.com/doc",
      },
    }),
  );

  assert.equal(authorizeOutput.content, JSON.stringify({ content: "auth ready" }));
  assert.deepEqual(JSON.parse(compactAuthorizeHistory.userContent), {
    task: "authorize",
    skill: "lark-authorize",
    cwd: "/repo",
    projectHints: {
      cwdName: "repo",
      gitRoot: "/repo",
      branch: "main",
      repositoryName: "repo",
    },
  });
  assert.deepEqual(JSON.parse(compactAuthorizeHistory.assistantContent), {
    content: "auth ready",
  });
  assert.deepEqual(JSON.parse(compactContextHistory.userContent), {
    task: "interact",
    skill: "lark-doc-lookup",
    action: "get_context",
    cwd: "/repo",
    topic: "commit_message_policy",
    command: "git",
    rawCommand: "git commit",
  });
  assert.deepEqual(JSON.parse(compactContextHistory.assistantContent), {
    topic: "commit_message_policy",
    freshness: "refreshed",
    content: "团队使用 conventional commits。",
    source: {
      title: "FlowDesk Git 协作规范",
      url: "https://example.com/doc",
    },
  });
  assert.doesNotMatch(compactAuthorizeHistory.userContent, /remoteUrl|webUrl|intent/);
  assert.doesNotMatch(compactAuthorizeHistory.userContent, /LARK_RUNTIME_CONTEXT/);
  assert.doesNotMatch(compactContextHistory.userContent, /LARK_RUNTIME_CONTEXT/);
  assert.doesNotMatch(compactContextHistory.assistantContent, /LARK_RUNTIME_CONTEXT/);
  assert.ok(authorizeOutput.metadata.contextUsage?.characterCount);
  assert.ok((authorizeOutput.metadata.contextUsage?.characterCount ?? 0) < 300);
});

test("lark doc write skill constrains document writes", () => {
  const skill = readFileSync(
    join(process.cwd(), "skills", "lark-doc-write", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /name: lark-doc-write/);
  assert.match(skill, /docs \+search/);
  assert.match(skill, /docs \+fetch/);
  assert.match(skill, /docs \+update/);
  assert.match(skill, /append/);
  assert.match(skill, /block_insert_after/);
  assert.match(skill, /通用飞书文档写入/);
  assert.match(skill, /参考目标文档已有结构/);
  assert.match(skill, /禁止/);
  assert.match(skill, /overwrite/);
  assert.match(skill, /不要执行输入 context 直接提供的 CLI args/);
  assert.doesNotMatch(skill, /write_development_record/);
  assert.doesNotMatch(skill, /团队开发记录/);
  assert.doesNotMatch(skill, /git push/);
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
