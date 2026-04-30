import { execFile } from "node:child_process";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { toolStrategy } from "langchain";
import { z } from "zod";

import type {
  AgentRunMetadata,
  CommandAgent,
  CommandContext,
  CommandAgentOutput,
  CommandResult,
  LarkAgent,
  LarkInteractionRequest,
} from "./types.js";
import { createLangChainAgent, createLangChainChatModel } from "./runtime/langchain-agent.js";
import {
  createSkillRegistry,
  formatAvailableSkills,
  type SkillRegistry,
} from "./skill-registry.js";
import { readTldrPage } from "../integrations/tldr.js";
import { getDefaultSkillRootDir } from "../runtime/project-root.js";

const DEFAULT_SKILL_ROOT_DIR = getDefaultSkillRootDir(import.meta.url);

export const COMMAND_AGENT_TASK_SKILLS = {
  help: "command-help",
  commitMessage: "command-git-commit-message",
  afterFail: "command-after-fail",
  afterSuccess: "command-after-success",
} as const;

export type CommandAgentTaskName = keyof typeof COMMAND_AGENT_TASK_SKILLS;
export type CommandAgentTaskSkill =
  (typeof COMMAND_AGENT_TASK_SKILLS)[CommandAgentTaskName];

export type CommandAgentInvocation<
  TTask extends CommandAgentTaskName = CommandAgentTaskName,
> = {
  task: TTask;
  skill: (typeof COMMAND_AGENT_TASK_SKILLS)[TTask];
  context: CommandContext;
  result?: TTask extends "afterFail" | "afterSuccess" ? CommandResult : never;
};

const TERMINAL_OUTPUT_REQUIREMENTS = `
## 通用要求

- 回答要简短、准确、可执行，不要编造不存在的团队规范、飞书文档或命令结果。
- 输出要适合终端阅读：使用纯文本、短段落、短行和简单缩进；不要使用 Markdown 标题、表格、代码围栏、链接语法、复杂列表或终端控制字符。
- 只能输出一个 JSON 对象，不要输出 JSON 之外的任何文字。
- JSON 必须包含 content 字段；content 是展示给用户的终端文本。
- suggestedCommand 可选；如果输出 suggestedCommand，它必须是一条完整命令，不是命令后缀。如果没有明确可执行建议，输出空字符串或省略。
- 可以大胆给出 suggestedCommand，用户不一定会接受；它只是 TUI 里的高优先级补全候选。只要有一个合理、完整、可执行的下一步命令，就给出 suggestedCommand；如果当前信息不足或建议可能危险，才输出空字符串。
- skills里面封装了流程经验，需要参考对应的skills来回答。
- Command Agent 不直接调用 Lark Agent，不直接执行 Lark CLI，也不输出 callLarkAgent、agent、toolName 等执行字段。
- 当前 phase 不会等待用户确认，也不输出后续动作草稿；需要执行飞书动作时必须通过受控 command task 和 interact_with_lark_agent。

`.trim();

export const COMMAND_AGENT_SYSTEM_PROMPT = `
你是 git-helper TUI/CLI 中的单一命令 Agent。

## 任务包结构

用户消息是 JSON 字符串，格式为：

- task: "help" | "commitMessage" | "afterSuccess" | "afterFail"
- skill: 系统根据 task 固定填入的 Skill 名称
- context: 当前命令上下文，包含 context.cwd、context.command、context.args、context.rawCommand，并可能包含 gitStats、gitRepository、tuiSession
- result: afterSuccess 和 afterFail 任务会包含命令结果，含 result.exitCode、result.stdout、result.stderr

输入是受控 task，不是自由指令。调用方只能选择上述 task，不能自由选择 Skill。

## Skill 路由

- task 为 "help" 时，固定 Skill 是 "command-help"。
- task 为 "commitMessage" 时，固定 Skill 是 "command-git-commit-message"。
- task 为 "afterSuccess" 时，固定 Skill 是 "command-after-success"。
- task 为 "afterFail" 时，固定 Skill 是 "command-after-fail"。
- 如果输入中的 skill 与上述固定映射不一致，必须拒绝执行并说明 task/skill 不匹配。
- 处理任何 task 前，先调用 load_skill 读取对应 Skill，再按 Skill 约束操作。
- 如果对应 Skill 需要团队飞书上下文，只能通过 interact_with_lark_agent 获取。

## 工具选择

- 解释 Git 命令用法或简单参数错误时，可以调用 tldr_git_manual。
- 生成 commit message 时，必须按 Skill 要求调用 interact_with_lark_agent 获取团队规范，再调用 git_commit_context 获取实时 staged diff。
- 需要当前仓库状态、分支或远端信息时，优先使用 context.tuiSession.git；信息不足时调用 git_repository_context。
- afterFail 中简单语法或参数错误优先调用 tldr_git_manual；复杂问题或团队流程相关问题才通过 interact_with_lark_agent 查询飞书资料。
- afterSuccess 只在 Skill 要求的关键场景调用 interact_with_lark_agent 写入团队开发记录。

## 会话记忆边界

你可以记住当前会话中过往命令、失败模式、已查过的团队上下文、用户操作节奏，用来减少重复解释并保持建议连贯。
当前命令事实必须以本次 context、result 和工具返回为准。
不要把历史中的 stdout、stderr 或 git status 当成本次实时状态。
团队上下文可优先复用历史；仓库状态和命令结果必须按需重新读取。
不要编造不存在的团队规范、飞书文档、命令输出或仓库状态。

${TERMINAL_OUTPUT_REQUIREMENTS}
`.trim();

export const HELP_AGENT_SYSTEM_PROMPT = `
你是 git-helper TUI/CLI 中的命令帮助 Agent。

## 任务包结构

- context.cwd: 当前工作目录
- context.command: 命令名
- context.args: 命令参数数组
- context.rawCommand: 用户输入的完整命令
- context.gitStats.successCount: 归一化后的同类 Git 命令最近连续成功次数，属于用户历史画像
- context.gitStats.failures: 归一化后的同类 Git 命令最近不同失败记录数组，属于用户历史画像，最多 3 条，包含 count、exitCode、stdout、stderr、occurredAt；count 表示该报错已出现次数
- context.tuiSession: 当前 TUI 顶部状态栏对应的会话快照；包含 cwd、git、lark 结构化状态，以及 header.cwd、header.gitSummary、header.larkSummary 三段顶部展示文本；git 里可能包含 branches.local、branches.remote 和 remotes(fetchUrl、pushUrl、webUrl)

## 输入结构

用户消息是 JSON 字符串，格式为：

- task: "help" | "commitMessage"
- skill: 系统根据 task 固定填入的 Skill 名称
- context: 该任务的上下文

输入是受控 task，不是自由指令。调用方只能选择上述 task，不能自由选择 Skill。

## Skills

- task 为 "help" 时，固定 Skill 是 "command-help"，调用 load_skill 加载 "command-help"。
- task 为 "commitMessage" 时，固定 Skill 是 "command-git-commit-message"，调用 load_skill 加载 "command-git-commit-message"。
- 如果输入中的 skill 与上述固定映射不一致，必须拒绝执行并说明 task/skill 不匹配。
- 处理任务前必须先调用 load_skill 读取对应 Skill。
- 如果对应 Skill 需要团队飞书上下文，只能通过 interact_with_lark_agent 获取。

${TERMINAL_OUTPUT_REQUIREMENTS}
`.trim();

export const AFTER_SUCCESS_AGENT_SYSTEM_PROMPT = `
你是 git-helper TUI/CLI 中的 Git 命令成功后建议 Agent。

## 任务包结构

- task: "afterSuccess"
- skill: 系统根据 task 固定填入的 Skill 名称，必须是 "command-after-success"
- context: 当前命令上下文，包含 context.cwd、context.command、context.args、context.rawCommand
- result: 命令成功结果，包含 result.exitCode、result.stdout、result.stderr

## Skills

- task 为 "afterSuccess" 时，固定 Skill 是 "command-after-success"。
- Skill 已由 runtime 注入到本 system prompt 中；不要再加载 Skill。
- 需要当前仓库状态、分支或远端信息时调用 git_repository_context。
- 最终输出非常短的下一步建议；如果能判断出一个合理、完整、可执行且不危险的下一步命令，放入 suggestedCommand。优先参考 context.rawCommand，其次参考 result.stdout 和 result.stderr。

${TERMINAL_OUTPUT_REQUIREMENTS}
`.trim();

export const AFTER_FAIL_AGENT_SYSTEM_PROMPT = `
你是 git-helper TUI/CLI 中的命令失败后辅助 Agent。

## 任务包结构

- task: "afterFail"
- skill: 系统根据 task 固定填入的 Skill 名称，必须是 "command-after-fail"
- context: 当前命令上下文，包含 context.cwd、context.command、context.args、context.rawCommand
- result: 命令失败结果，包含 result.exitCode、result.stdout、result.stderr

## Skills

- task 为 "afterFail" 时，固定 Skill 是 "command-after-fail"。
- Skill 已由 runtime 注入到本 system prompt 中；不要再加载 Skill。
- 简单的语法或参数错误优先调用 tldr_git_manual。
- 需要仓库状态、分支或远端信息时调用 git_repository_context。
- 复杂问题或团队流程相关问题才通过 interact_with_lark_agent 查询飞书资料。
- 最终输出非常短的排查方向或下一步命令；如果能判断出一个合理、完整、可执行且不危险的修复或排查命令，放入 suggestedCommand。优先参考 result.stderr，其次参考 result.stdout 和 context.rawCommand。

${TERMINAL_OUTPUT_REQUIREMENTS}
`.trim();

export function formatAfterFailAgentSystemPrompt(skillContent: string) {
  return `${AFTER_FAIL_AGENT_SYSTEM_PROMPT}

## Injected Skill: command-after-fail

${skillContent.trim()}`.trim();
}

export function formatAfterSuccessAgentSystemPrompt(skillContent: string) {
  return `${AFTER_SUCCESS_AGENT_SYSTEM_PROMPT}

## Injected Skill: command-after-success

${skillContent.trim()}`.trim();
}

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

type GitRepositoryContextOptions = {
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

type InteractWithLarkAgentToolOptions = {
  larkAgent?: Pick<LarkAgent, "interact"> | undefined;
};

type CommandAgentToolOptions = InteractWithLarkAgentToolOptions & {
  skillRegistry?: SkillRegistry | undefined;
};

export function createLoadCommandSkillTool(registry: SkillRegistry): StructuredToolInterface {
  return tool(
    async ({ skillName }) => registry.loadSkill(skillName),
    {
      name: "load_skill",
      description: `Load a specialized Command skill.

Available skills:
${formatAvailableSkills(registry.listSkills())}

Returns the skill's prompt and context.`,
      schema: z.object({
        skillName: z.string().describe("Name of command skill to load"),
      }),
    },
  );
}

export function createInteractWithLarkAgentTool({
  larkAgent,
}: InteractWithLarkAgentToolOptions = {}): StructuredToolInterface {
  return tool(
    async (input) => {
      if (!larkAgent) {
        if (input.action === "get_context") {
          return JSON.stringify({
            topic: input.topic,
            content: "",
            freshness: "missing",
          });
        }

        return JSON.stringify({
          content: "未配置 Lark Agent，开发记录未更新。",
        });
      }

      return JSON.stringify(await larkAgent.interact(normalizeLarkInteractionInput(input)));
    },
    {
      name: "interact_with_lark_agent",
      description:
        "与 Lark Agent 执行受控交互。只接受固定交互参数，不接受 lark-cli args",
      schema: createInteractWithLarkAgentSchema(),
    },
  );
}

function createInteractWithLarkAgentSchema() {
  const repositorySchema = z
    .object({
      root: z.string().optional(),
      remoteUrl: z.string().optional(),
      webUrl: z.string().optional(),
    })
    .strict()
    .optional();
  const commandContextSchema = {
    cwd: z.string().describe("当前工作目录，必须使用输入 context.cwd。"),
    reason: z.string().describe("请求该交互的原因。"),
    command: z.string().optional(),
    rawCommand: z.string().optional(),
    repository: repositorySchema,
  };

  return z.discriminatedUnion("action", [
    z
      .object({
        action: z.literal("get_context"),
        ...commandContextSchema,
        topic: z
          .enum(["commit_message_policy", "troubleshooting_reference"])
          .describe("需要的飞书上下文主题。"),
      })
      .strict(),
    z
      .object({
        action: z.literal("send_message"),
        cwd: z.string().describe("当前工作目录，必须使用输入 context.cwd。"),
        reason: z.string().describe("请求该交互的原因。"),
        recipient: z.string().optional(),
        message: z.string(),
        summary: z.string().optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal("write_development_record"),
        ...commandContextSchema,
        result: z
          .object({
            exitCode: z.number(),
            stdout: z.string(),
            stderr: z.string(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  ]);
}

type InteractWithLarkAgentInput = z.infer<ReturnType<typeof createInteractWithLarkAgentSchema>>;

function normalizeLarkInteractionInput(
  input: InteractWithLarkAgentInput,
): LarkInteractionRequest {
  if (input.action === "send_message") {
    return {
      action: "send_message",
      cwd: input.cwd,
      ...(input.recipient ? { recipient: input.recipient } : {}),
      message: input.message,
      ...(input.summary ? { summary: input.summary } : {}),
    };
  }

  const compactRepository = compactLarkContextRepository(input.repository);
  if (input.action === "get_context") {
    return {
      action: "get_context",
      topic: input.topic,
      cwd: input.cwd,
      reason: input.reason,
      ...(input.command ? { command: input.command } : {}),
      ...(input.rawCommand ? { rawCommand: input.rawCommand } : {}),
      ...(compactRepository ? { repository: compactRepository } : {}),
    };
  }

  return {
    action: "write_development_record",
    cwd: input.cwd,
    reason: input.reason,
    ...(input.command ? { command: input.command } : {}),
    ...(input.rawCommand ? { rawCommand: input.rawCommand } : {}),
    ...(input.result ? { result: input.result } : {}),
    ...(compactRepository ? { repository: compactRepository } : {}),
  };
}

function compactLarkContextRepository(
  repository:
    | {
        root?: string | undefined;
        remoteUrl?: string | undefined;
        webUrl?: string | undefined;
      }
    | undefined,
): {
  root?: string;
  remoteUrl?: string;
  webUrl?: string;
} | undefined {
  if (!repository) {
    return undefined;
  }

  const compacted = {
    ...(repository.root ? { root: repository.root } : {}),
    ...(repository.remoteUrl ? { remoteUrl: repository.remoteUrl } : {}),
    ...(repository.webUrl ? { webUrl: repository.webUrl } : {}),
  };
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function createCommandAgentTools(options: CommandAgentToolOptions = {}) {
  const registry =
    options.skillRegistry ??
    createSkillRegistry({
      rootDir: DEFAULT_SKILL_ROOT_DIR,
      namePrefixes: ["command-"],
    });

  return [
    createLoadCommandSkillTool(registry),
    createTldrGitManualTool(),
    createGitCommitContextTool(),
    createGitRepositoryContextTool(),
    createInteractWithLarkAgentTool(options),
  ];
}

export function createCommandAfterFailTools(options: CommandAgentToolOptions = {}) {
  return [
    createTldrGitManualTool(),
    createGitRepositoryContextTool(),
    createInteractWithLarkAgentTool(options),
  ];
}

export function createCommandAfterSuccessTools(options: CommandAgentToolOptions = {}) {
  return [
    createGitRepositoryContextTool(),
    createInteractWithLarkAgentTool(options),
  ];
}

export const COMMAND_AGENT_TOOLS: StructuredToolInterface[] = createCommandAgentTools();

export function routeCommandAgentTask(context: {
  command: string;
  args: string[];
}): CommandAgentTaskName {
  return context.command === "git" && context.args[0] === "commit"
    ? "commitMessage"
    : "help";
}

export function formatCommandAgentInvocation<TTask extends CommandAgentTaskName>(
  task: TTask,
  context: CommandAgentInvocation<TTask>["context"],
  result?: CommandAgentInvocation<TTask>["result"],
) {
  const invocation: CommandAgentInvocation<TTask> = {
    task,
    skill: COMMAND_AGENT_TASK_SKILLS[task],
    context,
    ...(result ? { result } : {}),
  };
  return JSON.stringify(invocation);
}

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

export async function buildGitRepositoryContext({
  cwd,
  runGitCommand = runGit,
}: GitRepositoryContextOptions) {
  const [status, branch, remotes] = await Promise.all([
    runGitCommand(["status", "--short", "--branch"], cwd),
    runGitCommand(["branch", "--show-current"], cwd),
    runGitCommand(["remote", "-v"], cwd),
  ]);

  return {
    status: formatGitOutput("git status --short --branch", status, GIT_COMMIT_CONTEXT_SUMMARY_LIMIT),
    branch: formatGitOutput("git branch --show-current", branch, GIT_COMMIT_CONTEXT_SUMMARY_LIMIT),
    remotes: formatGitOutput("git remote -v", remotes, GIT_COMMIT_CONTEXT_SUMMARY_LIMIT),
  };
}

function createTldrGitManualTool(): StructuredToolInterface {
  return tool(
    async ({ command }) => readTldrPage(command),
    {
      name: "tldr_git_manual",
      description:
        "查询 tldr 中的 Git 命令快速手册。输入可以是 git push、git status 或 git-push 这样的命令名。",
      schema: z.object({
        command: z.string().describe("需要查询的 Git 命令，例如 git push 或 git status。"),
      }),
    },
  );
}

function createGitCommitContextTool(): StructuredToolInterface {
  return tool(
    async ({ cwd }) => JSON.stringify(await buildGitCommitContext({ cwd })),
    {
      name: "git_commit_context",
      description:
        "按需读取生成 commit message 所需的已暂存 Git 信息。只在 git commit 场景使用；内部固定运行 git status --short、git diff --cached、git log -5 --pretty=%s，并会截断过长输出。",
      schema: z.object({
        cwd: z.string().describe("当前工作目录，必须使用输入 context.cwd。"),
      }),
    },
  );
}

function createGitRepositoryContextTool(): StructuredToolInterface {
  return tool(
    async ({ cwd }) => JSON.stringify(await buildGitRepositoryContext({ cwd })),
    {
      name: "git_repository_context",
      description:
        "读取 Git 仓库上下文。内部固定运行 git status --short --branch、git branch --show-current、git remote -v，并会截断过长输出。",
      schema: z.object({
        cwd: z.string().describe("当前工作目录，必须使用输入 context.cwd。"),
      }),
    },
  );
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
    suggestedCommand: z.string().optional(),
  })
  .strict();

export const COMMAND_AGENT_TOOL_RESPONSE_FORMAT = toolStrategy(COMMAND_AGENT_RESPONSE_SCHEMA);

export const COMMAND_AGENT_RESPONSE_FORMAT = COMMAND_AGENT_TOOL_RESPONSE_FORMAT;

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

export type CommandAgentOptions = {
  larkAgent?: Pick<LarkAgent, "interact"> | undefined;
  skillRegistry?: SkillRegistry | undefined;
  skillRootDir?: string | undefined;
  model?: ReturnType<typeof createLangChainChatModel> | undefined;
};

export function createCommandAgent(options: CommandAgentOptions = {}): CommandAgent {
  const skillRegistry =
    options.skillRegistry ??
    createSkillRegistry({
      rootDir: options.skillRootDir ?? DEFAULT_SKILL_ROOT_DIR,
      namePrefixes: ["command-"],
    });
  const model = options.model ?? createLangChainChatModel({ modelRole: "command" });
  const agent = createLangChainAgent({
    name: "Command Agent",
    systemPrompt: COMMAND_AGENT_SYSTEM_PROMPT,
    tools: createCommandAgentTools({
      larkAgent: options.larkAgent,
      skillRegistry,
    }),
    model,
    responseFormat: COMMAND_AGENT_RESPONSE_FORMAT,
    preserveHistory: true,
  });

  return {
    async beforeRun(context) {
      const agentResult = await agent.invokeWithMetadata(
        formatCommandAgentInvocation(routeCommandAgentTask(context), context),
      );
      return withAgentMetadata(parseCommandAgentOutput(agentResult.content), agentResult.metadata);
    },
    async afterSuccess(context, result) {
      const agentResult = await agent.invokeWithMetadata(
        formatCommandAgentInvocation("afterSuccess", context, result),
      );
      return withAgentMetadata(parseCommandAgentOutput(agentResult.content), agentResult.metadata);
    },
    async afterFail(context, result) {
      const agentResult = await agent.invokeWithMetadata(
        formatCommandAgentInvocation("afterFail", context, result),
      );
      return withAgentMetadata(parseCommandAgentOutput(agentResult.content), agentResult.metadata);
    },
  };
}
