import { execFile } from "node:child_process";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { providerStrategy } from "langchain";
import { z } from "zod";

import type { CommandAgent, CommandAgentOutput, AgentRunMetadata } from "./types.js";
import { createLangChainAgent, createLangChainChatModel } from "./runtime/langchain-agent.js";
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
- 可以大胆给出 suggestedCommand，用户不一定会接受；它只是 TUI 里的高优先级补全候选。只要有一个合理、完整、可执行的下一步命令，就给出 suggestedCommand；如果当前信息不足或建议可能危险，才输出空字符串。
`.trim();

export const HELP_AGENT_SYSTEM_PROMPT = `
你是 git-helper TUI/CLI 中的命令帮助 Agent。

## 输入结构

- context.cwd: 当前工作目录
- context.command: 命令名
- context.args: 命令参数数组
- context.rawCommand: 用户输入的完整命令
- context.gitStats.successCount: 归一化后的同类 Git 命令最近连续成功次数，属于用户历史画像
- context.gitStats.failures: 归一化后的同类 Git 命令最近不同失败记录数组，属于用户历史画像，最多 3 条，包含 count、exitCode、stdout、stderr、occurredAt；count 表示该报错已出现次数
- context.tuiSession: 当前 TUI 顶部状态栏对应的会话快照；包含 cwd、git、lark 结构化状态，以及 header.cwd、header.gitSummary、header.larkSummary 三段顶部展示文本

用户不知道这条命令该如何使用，需要请求你的帮助。
请给出该命令对应的参数，和使用方法。
你可以根据当前输入、用户历史画像和顶部状态栏给出 suggestedCommand。
suggestedCommand 不只用于 commit message 场景。
如果是 Git 命令，优先使用 tldr_git_manual 工具查询通用用法，再结合输入上下文回答。
如果 context.command 是 git 且 context.args 的第一项是 commit，优先考虑生成 commit message。需要判断当前已暂存变更时，必须调用 git_commit_context 工具获取 Git 信息；不要要求初始 context 提供 diff、status 或 recent commits。
生成 commit message 时，content 输出生成的 commit message 或一条极短说明；suggestedCommand 输出完整提交命令，例如 git commit -m "feat: add structured agent output"。不要执行 git commit，不要要求用户执行命令。只基于 stagedDiff 生成；如果 stagedDiff 为空，提示用户先 git add 需要提交的内容，不要基于未暂存内容生成提交信息；如果 recentCommits 存在，尽量贴近其中的语言、粒度和前缀风格。
commit message 场景的当前工作区状态只能以 git_commit_context 工具返回的实时结果为准，其次参考 context.tuiSession；不要把 gitStats.failures 中的历史失败输出当成当前工作区状态，也不要因为历史 failures 里出现 nothing to commit 就拒绝生成 commit message。
如果 context.gitStats 存在，需要参考 successCount 和 failures：
成功次数较高且没有近期失败时，回答可以更短，只补充关键参数提醒。
存在近期失败时，可以结合 failures 中的错误输出解释用户过去可能遇到的问题和下一步命令；但 failures 始终是历史画像，不是当前事实。
如果 context.tuiSession 存在，可以结合顶部状态栏中的 git/lark 状态给出更贴近当前环境的建议；不要编造不存在的分支、远端、登录身份或文件名。

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
只要能从失败输出判断出一个合理、完整、可执行的修复或排查命令，就给出 suggestedCommand。

${TERMINAL_OUTPUT_REQUIREMENTS}
`.trim();

export const GIT_COMMIT_CONTEXT_DIFF_LIMIT = 3000;
export const GIT_COMMIT_CONTEXT_SUMMARY_LIMIT = 1000;

type GitCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type GitCommandRunner = (
  args: string[],
  cwd: string,
) => Promise<GitCommandResult>;

type GitCommitContextOptions = {
  cwd: string;
  runGitCommand?: GitCommandRunner | undefined;
};

type GitCommitContextOutput = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

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
  tool(
    async ({ cwd }) => JSON.stringify(await buildGitCommitContext({ cwd })),
    {
      name: "git_commit_context",
      description:
        "按需读取生成 commit message 所需的已暂存 Git 信息。只在 git commit 场景使用；内部固定运行 git status --short、git diff --cached、git log -5 --pretty=%s，并会截断过长输出。",
      schema: z.object({
        cwd: z.string().describe("当前工作目录，必须使用输入 context.cwd。"),
      }),
    },
  ),
];

export async function buildGitCommitContext({
  cwd,
  runGitCommand = runGit,
}: GitCommitContextOptions) {
  const [status, stagedDiff, recentCommits] = await Promise.all([
    runGitCommand(["status", "--short"], cwd),
    runGitCommand(["diff", "--cached"], cwd),
    runGitCommand(["log", "-5", "--pretty=%s"], cwd),
  ]);

  const recentCommitsOutput = formatGitOutput(
    "git log -5 --pretty=%s",
    recentCommits,
    GIT_COMMIT_CONTEXT_SUMMARY_LIMIT,
  );

  return {
    status: formatGitOutput("git status --short", status, GIT_COMMIT_CONTEXT_SUMMARY_LIMIT),
    stagedDiff: formatGitOutput("git diff --cached", stagedDiff, GIT_COMMIT_CONTEXT_DIFF_LIMIT),
    recentCommits: {
      ...recentCommitsOutput,
      subjects: recentCommitsOutput.stdout.split("\n").filter(Boolean),
    },
  };
}

function formatGitOutput(
  command: string,
  result: GitCommandResult,
  limit: number,
): GitCommitContextOutput {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  return {
    command,
    exitCode: result.exitCode,
    stdout: stdout.slice(0, limit),
    stderr: stderr.slice(0, limit),
    truncated: stdout.length > limit || stderr.length > limit,
  };
}

function runGit(args: string[], cwd: string): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: 1500,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: getExitCode(error),
          stdout,
          stderr,
        });
      },
    );
  });
}

function getExitCode(error: unknown) {
  if (!error) {
    return 0;
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "number") {
      return code;
    }
  }

  return 1;
}

export const COMMAND_AGENT_OUTPUT_SCHEMA = z
  .object({
    content: z.string(),
    suggestedCommand: z.string().optional(),
  })
  .strict();

const COMMAND_AGENT_RESPONSE_SCHEMA = z
  .object({
    content: z.string(),
    suggestedCommand: z.string(),
  })
  .strict();

export const COMMAND_AGENT_PROVIDER_RESPONSE_FORMAT = providerStrategy({
  schema: COMMAND_AGENT_RESPONSE_SCHEMA,
  strict: true,
});

export const COMMAND_AGENT_RESPONSE_FORMAT = COMMAND_AGENT_PROVIDER_RESPONSE_FORMAT;

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

function withAgentMetadata(
  output: CommandAgentOutput | undefined,
  metadata: AgentRunMetadata,
): CommandAgentOutput | undefined {
  return output ? { ...output, metadata } : undefined;
}

export function createCommandAgent(): CommandAgent {
  const model = createLangChainChatModel({ modelRole: "command" });
  const helpAgent = createLangChainAgent({
    name: "Command Help Agent",
    systemPrompt: HELP_AGENT_SYSTEM_PROMPT,
    tools: COMMAND_AGENT_TOOLS,
    model,
    responseFormat: COMMAND_AGENT_RESPONSE_FORMAT,
  });
  const afterSuccessAgent = createLangChainAgent({
    name: "Command After Success Agent",
    systemPrompt: AFTER_SUCCESS_AGENT_SYSTEM_PROMPT,
    model,
    responseFormat: COMMAND_AGENT_RESPONSE_FORMAT,
  });
  const afterFailAgent = createLangChainAgent({
    name: "Command After Fail Agent",
    systemPrompt: AFTER_FAIL_AGENT_SYSTEM_PROMPT,
    model,
    responseFormat: COMMAND_AGENT_RESPONSE_FORMAT,
  });

  return {
    async beforeRun(context) {
      const result = await helpAgent.invokeWithMetadata(JSON.stringify({ context }));
      return withAgentMetadata(parseCommandAgentOutput(result.content), result.metadata);
    },
    async afterSuccess(context, result) {
      const agentResult = await afterSuccessAgent.invokeWithMetadata(
        JSON.stringify({ context, result }),
      );
      return withAgentMetadata(parseCommandAgentOutput(agentResult.content), agentResult.metadata);
    },
    async afterFail(context, result) {
      const agentResult = await afterFailAgent.invokeWithMetadata(
        JSON.stringify({ context, result }),
      );
      return withAgentMetadata(parseCommandAgentOutput(agentResult.content), agentResult.metadata);
    },
  };
}
