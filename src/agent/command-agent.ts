import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import type { CommandAgent } from "./types.js";
import { createLangChainAgent } from "./langchain-agent.js";
import { readTldrPage } from "../integrations/tldr.js";

export const COMMAND_AGENT_SYSTEM_PROMPT = `
你是 git-helper TUI/CLI 中的命令辅助 Agent。

你每次都会收到一个 JSON 输入，其中一定包含 phase 字段。phase 表示当前 Agent 被调用的阶段。

你需要先读取 phase，再根据对应阶段的职责处理输入。不要把不同阶段的任务混在一起。

## 输入结构

常见输入字段：

- phase: askForHelp、beforeRun、afterSuccess 或 afterFail
- context.cwd: 当前工作目录
- context.command: 命令名
- context.args: 命令参数数组
- context.rawCommand: 用户输入的完整命令
- result.exitCode: 命令退出码
- result.stdout: 命令标准输出
- result.stderr: 命令错误输出

## Phase 行为

### askForHelp
用户不知道这条命令该如何使用，需要请求你的帮助。

请给出该命令对应的参数，和使用方法。
如果是 Git 命令，优先使用 tldr_git_manual 工具查询通用用法，再结合输入上下文回答。

### beforeRun
TODO: 在这里填写命令执行前，Agent 应该做什么。

### afterSuccess
TODO: 在这里填写命令执行成功后，Agent 应该做什么。

### afterFail
TODO: 在这里填写命令执行失败后，Agent 应该做什么。

## 通用要求

- 回答要简短、准确、可执行。
- 不要编造不存在的团队规范、飞书文档或命令结果。
- 如果需要引用上下文，只基于输入 JSON 中实际存在的信息。
- 如果某个 phase 的职责尚未填写，先给出最小、有帮助的回答。
`.trim();

export const COMMAND_AGENT_TOOLS: StructuredToolInterface[] = [
  tool(
    async ({ command }) => readTldrPage(command),
    {
      name: "tldr_git_manual",
      description:
        "查询 tldr 中的 Git 命令快速手册。输入可以是 git push、git status 或 git-push 这样的命令名。",
      schema: z.object({
        command: z.string().describe("需要查询的 Git 命令，例如 git push 或 git status。"),
      }),
    },
  ),
];

export function createCommandAgent(): CommandAgent {
  const agent = createLangChainAgent({
    name: "Command Agent",
    systemPrompt: COMMAND_AGENT_SYSTEM_PROMPT,
    tools: COMMAND_AGENT_TOOLS,
  });

  return {
    async askForHelp(context) {
      return agent.invoke(JSON.stringify({ phase: "askForHelp", context }));
    },
    async beforeRun(context) {
      await agent.invoke(JSON.stringify({ phase: "beforeRun", context }));
    },
    async afterSuccess(context, result) {
      await agent.invoke(JSON.stringify({ phase: "afterSuccess", context, result }));
    },
    async afterFail(context, result) {
      await agent.invoke(JSON.stringify({ phase: "afterFail", context, result }));
    },
  };
}
