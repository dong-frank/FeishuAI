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
- context.gitStats.successCount: 归一化后的同类 Git 命令最近连续成功次数
- context.gitStats.failures: 归一化后的同类 Git 命令最近不同失败记录数组，最多 3 条，包含 count、exitCode、stdout、stderr、occurredAt；count 表示该报错已出现次数
- result.exitCode: 命令退出码
- result.stdout: 命令标准输出
- result.stderr: 命令错误输出

## Phase 行为

### askForHelp
用户不知道这条命令该如何使用，需要请求你的帮助。

请给出该命令对应的参数，和使用方法。
如果是 Git 命令，优先使用 tldr_git_manual 工具查询通用用法，再结合输入上下文回答。
如果 context.gitStats 存在，需要参考 successCount 和 failures：
成功次数较高且没有近期失败时，回答可以更短，只补充关键参数提醒。
存在近期失败时，优先结合 failures 中的错误输出解释可能原因和下一步命令。

### afterSuccess
关键 Git 命令已经成功执行。你需要给出非常短的下一步建议，帮助用户继续推进工作。

不要复述成功输出，不要解释已经成功的事实。
根据命令类型给出 1-3 条可执行提醒：
push 后，提醒是否需要打开 PR、通知维护者或检查远端状态。
commit 后，提醒是否需要 push、继续拆分提交或查看状态。
pull、merge、rebase 后，提醒检查 git status，并按项目习惯运行必要测试。

### afterFail
TODO: 在这里填写命令执行失败后，Agent 应该做什么。

## 通用要求

- 回答要简短、准确、可执行。
- 不要编造不存在的团队规范、飞书文档或命令结果。
- 如果需要引用上下文，只基于输入 JSON 中实际存在的信息。
- 如果某个 phase 的职责尚未填写，先给出最小、有帮助的回答。
- 输出要适合终端阅读：使用纯文本、短段落、短行和简单缩进；不要使用 Markdown 标题、表格、代码围栏、链接语法、复杂列表或终端控制字符。
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
      return agent.invoke(JSON.stringify({ phase: "askForHelp", context }));
    },
    async afterSuccess(context, result) {
      return agent.invoke(JSON.stringify({ phase: "afterSuccess", context, result }));
    },
    async afterFail(context, result) {
      await agent.invoke(JSON.stringify({ phase: "afterFail", context, result }));
    },
  };
}
