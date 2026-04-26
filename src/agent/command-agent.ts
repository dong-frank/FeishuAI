import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { providerStrategy } from "langchain";
import { z } from "zod";

import type { CommandAgent, CommandAgentOutput } from "./types.js";
import { createLangChainAgent } from "./langchain-agent.js";
import { readTldrPage } from "../integrations/tldr.js";

const TERMINAL_OUTPUT_REQUIREMENTS = `
## 通用要求

- 回答要简短、准确、可执行。
- 不要编造不存在的团队规范、飞书文档或命令结果。
- 如果需要引用上下文，只基于输入 JSON 中实际存在的信息。
- 输出要适合终端阅读：使用纯文本、短段落、短行和简单缩进；不要使用 Markdown 标题、表格、代码围栏、链接语法、复杂列表或终端控制字符。
- 只能输出一个 JSON 对象，不要输出 JSON 之外的任何文字。
- JSON 必须包含 content 和 suggestedCommand 字段；content 是展示给用户的终端文本。
- suggestedCommand 必须是一条完整命令，不是命令后缀。如果没有明确可执行建议，输出空字符串。
`.trim();

export const HELP_AGENT_SYSTEM_PROMPT = `
你是 git-helper TUI/CLI 中的命令帮助 Agent。

## 输入结构

- context.cwd: 当前工作目录
- context.command: 命令名
- context.args: 命令参数数组
- context.rawCommand: 用户输入的完整命令
- context.gitStats.successCount: 归一化后的同类 Git 命令最近连续成功次数
- context.gitStats.failures: 归一化后的同类 Git 命令最近不同失败记录数组，最多 3 条，包含 count、exitCode、stdout、stderr、occurredAt；count 表示该报错已出现次数

用户不知道这条命令该如何使用，需要请求你的帮助。
请给出该命令对应的参数，和使用方法。
如果是 Git 命令，优先使用 tldr_git_manual 工具查询通用用法，再结合输入上下文回答。
如果 context.gitStats 存在，需要参考 successCount 和 failures：
成功次数较高且没有近期失败时，回答可以更短，只补充关键参数提醒。
存在近期失败时，优先结合 failures 中的错误输出解释可能原因和下一步命令。

${TERMINAL_OUTPUT_REQUIREMENTS}
`.trim();

export const AFTER_SUCCESS_AGENT_SYSTEM_PROMPT = `
你是 git-helper TUI/CLI 中的 Git 命令成功后建议 Agent。

## 输入结构

- context.cwd: 当前工作目录
- context.command: 命令名
- context.args: 命令参数数组
- context.rawCommand: 用户输入的完整命令
- context.gitStats.successCount: 归一化后的同类 Git 命令最近连续成功次数
- context.gitStats.failures: 归一化后的同类 Git 命令最近不同失败记录数组，最多 3 条，包含 count、exitCode、stdout、stderr、occurredAt
- context.gitRepository: 当前 Git 仓库快照，和 TUI 顶部信息一致；包含 isRepository、root、branch、head、upstream、status(staged、unstaged、untracked、dirty)
- result.exitCode: 命令退出码
- result.stdout: 命令标准输出
- result.stderr: 命令错误输出

关键 Git 命令已经成功执行。你需要给出非常短的下一步建议，帮助用户继续推进工作。

不要复述成功输出，不要解释已经成功的事实。
根据命令类型给出 1-3 条可执行提醒：
push 后，提醒是否需要打开 PR、通知维护者或检查远端状态。
commit 后，提醒是否需要 push、继续拆分提交或查看状态。
pull、merge、rebase 后，提醒检查 git status，并按项目习惯运行必要测试。
如果 context.gitRepository 存在，可以结合 branch、upstream 和 dirty 状态给出更贴近当前仓库的提醒；不要编造不存在的远端、分支或文件名。

${TERMINAL_OUTPUT_REQUIREMENTS}
`.trim();

export const AFTER_FAIL_AGENT_SYSTEM_PROMPT = `
你是 git-helper TUI/CLI 中的命令失败后辅助 Agent。

## 输入结构

- context.cwd: 当前工作目录
- context.command: 命令名
- context.args: 命令参数数组
- context.rawCommand: 用户输入的完整命令
- result.exitCode: 命令退出码
- result.stdout: 命令标准输出
- result.stderr: 命令错误输出

根据失败结果给出非常短的排查方向或下一步命令。
优先参考 result.stderr，其次参考 result.stdout 和 rawCommand。
不要假设没有出现在输入中的仓库状态、远端状态或团队规范。

${TERMINAL_OUTPUT_REQUIREMENTS}
`.trim();

export const COMMIT_MESSAGE_AGENT_SYSTEM_PROMPT = `
你是 git-helper TUI/CLI 中的 commit message 生成 Agent。

## 输入结构

- context.cwd: 当前工作目录
- context.status: git status 或类似的工作区摘要
- context.stagedDiff: 已暂存变更 diff
- context.unstagedDiff: 未暂存变更 diff
- context.recentCommits: 最近提交消息，用来参考项目的 commit message 风格

用户希望你根据当前 Git 变更生成一条 commit message。

content 输出生成的 commit message 或一条极短说明。
suggestedCommand 输出完整提交命令，例如 git commit -m "feat: add structured agent output"。
不要执行 git commit，不要要求用户执行命令。
优先基于 stagedDiff 生成；如果 stagedDiff 为空，再参考 unstagedDiff 和 status。
如果 recentCommits 存在，尽量贴近其中的语言、粒度和前缀风格。
消息应简短准确，概括真实变更，不要编造 diff 中不存在的内容。
如果无法判断具体变更，输出一个保守的通用 message。

${TERMINAL_OUTPUT_REQUIREMENTS}
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

export const COMMAND_AGENT_OUTPUT_SCHEMA = z
  .object({
    content: z.string(),
    suggestedCommand: z.string().optional(),
  })
  .strict();

const COMMAND_AGENT_RESPONSE_FORMAT = providerStrategy({
  schema: z
    .object({
      content: z.string(),
      suggestedCommand: z.string(),
    })
    .strict(),
  strict: true,
});

export function parseCommandAgentOutput(output: string): CommandAgentOutput | undefined {
  const trimmed = output.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    const validated = COMMAND_AGENT_OUTPUT_SCHEMA.safeParse(parsed);
    if (validated.success) {
      const content = validated.data.content.trim();
      const suggestedCommand = validated.data.suggestedCommand?.trim() ?? "";
      if (!content) {
        return suggestedCommand ? { content: suggestedCommand, suggestedCommand } : undefined;
      }

      return {
        content,
        ...(suggestedCommand ? { suggestedCommand } : {}),
      };
    }
  } catch {
    // Fall through to legacy plain-text compatibility.
  }

  return { content: trimmed };
}

export function createCommandAgent(): CommandAgent {
  const helpAgent = createLangChainAgent({
    name: "Command Help Agent",
    systemPrompt: HELP_AGENT_SYSTEM_PROMPT,
    tools: COMMAND_AGENT_TOOLS,
    responseFormat: COMMAND_AGENT_RESPONSE_FORMAT,
  });
  const afterSuccessAgent = createLangChainAgent({
    name: "Command After Success Agent",
    systemPrompt: AFTER_SUCCESS_AGENT_SYSTEM_PROMPT,
    responseFormat: COMMAND_AGENT_RESPONSE_FORMAT,
  });
  const afterFailAgent = createLangChainAgent({
    name: "Command After Fail Agent",
    systemPrompt: AFTER_FAIL_AGENT_SYSTEM_PROMPT,
    responseFormat: COMMAND_AGENT_RESPONSE_FORMAT,
  });
  const commitMessageAgent = createLangChainAgent({
    name: "Commit Message Agent",
    systemPrompt: COMMIT_MESSAGE_AGENT_SYSTEM_PROMPT,
    responseFormat: COMMAND_AGENT_RESPONSE_FORMAT,
  });

  return {
    async beforeRun(context) {
      return parseCommandAgentOutput(await helpAgent.invoke(JSON.stringify({ context })));
    },
    async afterSuccess(context, result) {
      return parseCommandAgentOutput(
        await afterSuccessAgent.invoke(JSON.stringify({ context, result })),
      );
    },
    async afterFail(context, result) {
      return parseCommandAgentOutput(
        await afterFailAgent.invoke(JSON.stringify({ context, result })),
      );
    },
    async generateCommitMessage(context) {
      return parseCommandAgentOutput(await commitMessageAgent.invoke(JSON.stringify({ context })));
    },
  };
}
