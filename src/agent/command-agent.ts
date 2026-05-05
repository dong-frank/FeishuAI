import { execFile } from "node:child_process";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { toolStrategy } from "langchain";
import { z } from "zod";

import type {
  AgentRunMetadata,
  AgentToolProgressHandler,
  CommandAgent,
  CommandChatContext,
  CommandContext,
  CommandAgentOutput,
  CommandResult,
  LarkAgent,
  LarkInteractionRequest,
} from "./types.js";
import {
  createFinalResponseTool,
  createLangChainAgent,
  createLangChainChatModel,
  formatRawToolCallsDebugOutput,
  withTuiDisplay,
} from "./runtime/langchain-agent.js";
import { createAgentHistoryStore } from "./runtime/agent-history-store.js";
import {
  createSkillRegistry,
  formatAvailableSkills,
  type SkillRegistry,
} from "./skill-registry.js";
import {
  buildAgentMemoryHint,
  createAgentMemoryTools,
  type AgentMemoryHint,
} from "./memory-tools.js";
import { readTldrPage } from "../integrations/tldr.js";
import { getDefaultSkillRootDir } from "../runtime/project-root.js";

const DEFAULT_SKILL_ROOT_DIR = getDefaultSkillRootDir(import.meta.url);

export const COMMAND_AGENT_TASK_SKILLS = {
  help: "command-help",
  commitMessage: "command-git-commit-message",
  afterFail: "command-after-fail",
  afterSuccess: "command-after-success",
  chat: "command-chat",
} as const;

export type CommandAgentTaskName = keyof typeof COMMAND_AGENT_TASK_SKILLS;
export type CommandAgentTaskSkill =
  (typeof COMMAND_AGENT_TASK_SKILLS)[CommandAgentTaskName];

export type CommandAgentInvocation<
  TTask extends CommandAgentTaskName = CommandAgentTaskName,
> = {
  task: TTask;
  skill: (typeof COMMAND_AGENT_TASK_SKILLS)[TTask];
  context: TTask extends "chat" ? CommandChatContext : CommandContext;
  result?: TTask extends "afterFail" | "afterSuccess" ? CommandResult : never;
  memory?: AgentMemoryHint;
};

const TERMINAL_OUTPUT_REQUIREMENTS = `
## 通用要求

- 回答要简短、准确、可执行，不要编造不存在的团队规范、飞书文档或命令结果。
- 输出要适合终端阅读：使用纯文本、短段落、短行和简单缩进；不要使用 Markdown 标题、表格、代码围栏、链接语法、复杂列表或终端控制字符。
- 完成所有必要工具调用后，必须调用且只调用一次 final_response 工具；调用 final_response 就表示本轮结束。
- 不要把最终回复直接写在普通 assistant 文本里；最终展示内容必须放入 final_response 的 content 字段。
- final_response 必须包含 content 字段；content 是展示给用户的终端文本。
- suggestedCommand 如果没有明确可执行建议，输出 null 或空字符串；如果输出字符串，它必须是一条完整命令，不是命令后缀。
- 可以大胆给出 suggestedCommand，用户不一定会接受；它只是 TUI 里的高优先级补全候选。只要有一个合理、完整、可执行的下一步命令，就给出 suggestedCommand；如果当前信息不足或建议可能危险，才输出空字符串。
- skills里面封装了流程经验，需要参考对应的skills来回答。
- Linus 不直接调用 Friday，不直接执行 Lark CLI，也不输出 callLarkAgent、agent、toolName 等执行字段。
- 当前 phase 不会等待用户确认，也不输出后续动作草稿；需要执行飞书动作时必须通过受控 command task 和 interact_with_lark_agent 请求 Friday。

`.trim();

export const COMMAND_AGENT_SYSTEM_PROMPT = `
你是 GITX TUI/CLI 中的 Linus，专注 Git 工作流 Agent。

## 角色设定

Linus 负责判断 Git 命令意图、解释失败原因、生成提交建议和给出下一步命令。你的语气专业、简短、可执行，适合终端阅读。需要飞书团队上下文或协作动作时，只能通过受控工具请求 Friday。

## 任务包结构

用户消息是 JSON 字符串，格式为：

- task: "help" | "commitMessage" | "afterSuccess" | "afterFail" | "chat"
- skill: 系统根据 task 固定填入的 Skill 名称
- context: 当前命令上下文，包含 context.cwd、context.command、context.args、context.rawCommand，并可能包含 gitStats、gitRepository、tuiSession
- chat 任务的 context 还包含 context.message，表示用户在 /chat 后输入的自由消息
- result: afterSuccess 和 afterFail 任务会包含命令结果，含 result.exitCode、result.stdout、result.stderr
- memory: 可选，系统从当前项目 .gitx/memory.json 自动注入的少量长期价值记忆摘要

输入是受控 task，不是自由指令。调用方只能选择上述 task，不能自由选择 Skill。

## Skill 路由

- task 为 "help" 时，固定 Skill 是 "command-help"。
- task 为 "commitMessage" 时，固定 Skill 是 "command-git-commit-message"。
- task 为 "afterSuccess" 时，固定 Skill 是 "command-after-success"。
- task 为 "afterFail" 时，固定 Skill 是 "command-after-fail"。
- task 为 "chat" 时，固定 Skill 是 "command-chat"。
- 如果输入中的 skill 与上述固定映射不一致，必须拒绝执行并说明 task/skill 不匹配。
- 处理任何 task 前，先调用 load_skill 读取对应 Skill，再按 Skill 约束操作。
- 如果对应 Skill 需要团队飞书上下文，只能通过 interact_with_lark_agent 请求 Friday 获取。

## 工具选择

- 输入中的 memory 是项目级长期价值记忆摘要，先参考它判断是否已有可复用经验；必要时再调用 read_memory 获取更多或更精确的记忆。长期价值记忆只用于辅助判断，不能覆盖本次 context、result 和实时工具返回。
- 只有当你得到可长期复用的团队规范、排障结论、用户工作流偏好或项目资料摘要时，才调用 save_memory 保存简短摘要。
- 不要保存实时 stdout、stderr、git status，不要保存完整命令输出、完整 Lark CLI JSON、密钥或完整文档正文。
- 解释 Git 命令用法或简单参数错误时，可以调用 tldr_git_manual。
- 生成 commit message 时，必须按 Skill 要求调用 interact_with_lark_agent 请求 Friday 获取团队规范，再调用 git_commit_context 获取实时 staged diff。
- 需要当前仓库状态、分支或远端信息时，优先使用 context.tuiSession.git；信息不足时调用 git_repository_context。
- afterFail 中简单语法或参数错误优先调用 tldr_git_manual；复杂问题或团队流程相关问题才通过 interact_with_lark_agent 请求 Friday 查询飞书资料。
- afterSuccess 只在 Skill 要求的关键场景调用 interact_with_lark_agent 请求 Friday 写入团队开发记录。
- chat 按用户 message 直接答复；只有解释 Git 用法、读取实时仓库信息或需要团队飞书上下文时才调用对应工具。

## 会话记忆边界

你可以记住当前会话中过往命令、失败模式、已查过的团队上下文、用户操作节奏，用来减少重复解释并保持建议连贯。
长期价值记忆保存在当前 Git 仓库的 .gitx/memory.json，可通过 read_memory 读取、通过 save_memory 写入。
每轮输入可能包含 memory.memories，里面只保留简短 content、category、tags、sourceAgent、sourceTask 和 updatedAt。
当前命令事实必须以本次 context、result 和工具返回为准。
不要把历史中的 stdout、stderr 或 git status 当成本次实时状态。
团队上下文可优先复用历史；仓库状态和命令结果必须按需重新读取。
不要编造不存在的团队规范、飞书文档、命令输出或仓库状态。

${TERMINAL_OUTPUT_REQUIREMENTS}
`.trim();

export const HELP_AGENT_SYSTEM_PROMPT = `
你是 GITX TUI/CLI 中的 Linus，负责 Git 命令帮助。

## 角色设定

Linus 专注解释 Git 命令、识别用户历史失败模式，并给出简短可执行建议。需要团队飞书上下文时，只能通过 interact_with_lark_agent 请求 Friday。

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
- 如果对应 Skill 需要团队飞书上下文，只能通过 interact_with_lark_agent 请求 Friday 获取。

${TERMINAL_OUTPUT_REQUIREMENTS}
`.trim();

export const AFTER_SUCCESS_AGENT_SYSTEM_PROMPT = `
你是 GITX TUI/CLI 中的 Linus，负责 Git 命令成功后建议。

## 角色设定

Linus 在 Git 命令成功后给出下一步建议。需要记录飞书开发动态或触发团队协作时，只能通过 interact_with_lark_agent 请求 Friday。

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
你是 GITX TUI/CLI 中的 Linus，负责 Git 命令失败后辅助。

## 角色设定

Linus 在 Git 命令失败后结合 stderr、仓库状态和必要的团队资料给出排查方向。需要飞书团队排障参考时，只能通过 interact_with_lark_agent 请求 Friday。

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
- 复杂问题或团队流程相关问题才通过 interact_with_lark_agent 请求 Friday 查询飞书资料。
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

const COMMAND_AGENT_FINAL_RESPONSE_SCHEMA = z
  .object({
    content: z.string(),
    suggestedCommand: z.string().nullable().optional(),
  })
  .strict();

export function createLoadCommandSkillTool(registry: SkillRegistry): StructuredToolInterface {
  return withTuiDisplay(
    tool(
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
    ),
    "加载 Linus 技能",
  );
}

export function createInteractWithLarkAgentTool({
  larkAgent,
}: InteractWithLarkAgentToolOptions = {}): StructuredToolInterface {
  return withTuiDisplay(
    tool(
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
            content: "未配置 Friday，开发记录未更新。",
          });
        }

        return JSON.stringify(await larkAgent.interact(normalizeLarkInteractionInput(input)));
      },
      {
        name: "interact_with_lark_agent",
        description:
          "与 Friday 执行受控交互。只接受固定交互参数，不接受 lark-cli args",
        schema: createInteractWithLarkAgentSchema(),
      },
    ),
    "请求 Friday",
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
    ...createAgentMemoryTools(),
    createTldrGitManualTool(),
    createGitCommitContextTool(),
    createGitRepositoryContextTool(),
    createInteractWithLarkAgentTool(options),
    createFinalResponseTool(COMMAND_AGENT_FINAL_RESPONSE_SCHEMA),
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
  memory?: AgentMemoryHint,
) {
  const invocation: CommandAgentInvocation<TTask> = {
    task,
    skill: COMMAND_AGENT_TASK_SKILLS[task],
    context,
    ...(result ? { result } : {}),
    ...(memory ? { memory } : {}),
  };
  return JSON.stringify(invocation);
}

async function formatCommandAgentInvocationWithMemory<TTask extends CommandAgentTaskName>(
  task: TTask,
  context: CommandAgentInvocation<TTask>["context"],
  result?: CommandAgentInvocation<TTask>["result"],
) {
  return formatCommandAgentInvocation(
    task,
    context,
    result,
    await buildAgentMemoryHint(context.cwd),
  );
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
  return withTuiDisplay(
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
    "查询 Git 手册",
  );
}

function createGitCommitContextTool(): StructuredToolInterface {
  return withTuiDisplay(
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
    "读取提交上下文",
  );
}

function createGitRepositoryContextTool(): StructuredToolInterface {
  return withTuiDisplay(
    tool(
      async ({ cwd }) => JSON.stringify(await buildGitRepositoryContext({ cwd })),
      {
        name: "git_repository_context",
        description:
          "读取 Git 仓库上下文。内部固定运行 git status --short --branch、git branch --show-current、git remote -v，并会截断过长输出。",
        schema: z.object({
          cwd: z.string().describe("当前工作目录，必须使用输入 context.cwd。"),
        }),
      },
    ),
    "读取仓库上下文",
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
    suggestedCommand: z.string().nullable().optional(),
  })
  .strict();

const COMMAND_AGENT_RESPONSE_SCHEMA = z
  .object({
    content: z.string(),
    suggestedCommand: z.string().nullable(),
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
  debugToolCalls = false,
): CommandAgentOutput | undefined {
  const rawToolCallsDebugOutput = debugToolCalls
    ? formatRawToolCallsDebugOutput(metadata.rawToolCalls)
    : "";

  if (!output) {
    const emptyOutputDebug = debugToolCalls
      ? formatRawToolCallsDebugOutput(metadata.rawToolCalls, metadata.rawAgentResult)
      : "";
    return emptyOutputDebug
      ? { content: emptyOutputDebug, metadata }
      : undefined;
  }

  return {
    ...output,
    content: appendDebugOutput(output.content, rawToolCallsDebugOutput),
    metadata,
  };
}

export type CommandAgentOptions = {
  larkAgent?: Pick<LarkAgent, "interact"> | undefined;
  skillRegistry?: SkillRegistry | undefined;
  skillRootDir?: string | undefined;
  model?: ReturnType<typeof createLangChainChatModel> | undefined;
  debugToolCalls?: boolean | undefined;
  onToolProgress?: AgentToolProgressHandler | undefined;
};

export function createCommandAgent(options: CommandAgentOptions = {}): CommandAgent {
  const skillRegistry =
    options.skillRegistry ??
    createSkillRegistry({
      rootDir: options.skillRootDir ?? DEFAULT_SKILL_ROOT_DIR,
      namePrefixes: ["command-"],
    });
  const model = options.model ?? createLangChainChatModel({ modelRole: "command" });
  const debugToolCalls = options.debugToolCalls ?? false;
  const agent = createLangChainAgent({
    name: "Linus",
    systemPrompt: COMMAND_AGENT_SYSTEM_PROMPT,
    tools: createCommandAgentTools({
      larkAgent: options.larkAgent,
      skillRegistry,
    }),
    model,
    preserveHistory: true,
    historyStore: createAgentHistoryStore("linus"),
    compactHistoryEntry: compactCommandAgentHistoryEntry,
    validateOutput: validateCommandAgentOutput,
    onToolProgress(event) {
      options.onToolProgress?.({
        ...event,
        agentKind: "command",
      });
    },
  });

  return {
    async chat(context) {
      const agentResult = await agent.invokeWithMetadata(
        await formatCommandAgentInvocationWithMemory("chat", context),
      );
      return withAgentMetadata(
        parseCommandAgentOutput(agentResult.content),
        agentResult.metadata,
        debugToolCalls,
      );
    },
    async beforeRun(context) {
      const agentResult = await agent.invokeWithMetadata(
        await formatCommandAgentInvocationWithMemory(routeCommandAgentTask(context), context),
      );
      return withAgentMetadata(
        parseCommandAgentOutput(agentResult.content),
        agentResult.metadata,
        debugToolCalls,
      );
    },
    async afterSuccess(context, result) {
      const agentResult = await agent.invokeWithMetadata(
        await formatCommandAgentInvocationWithMemory("afterSuccess", context, result),
      );
      return withAgentMetadata(
        parseCommandAgentOutput(agentResult.content),
        agentResult.metadata,
        debugToolCalls,
      );
    },
    async afterFail(context, result) {
      const agentResult = await agent.invokeWithMetadata(
        await formatCommandAgentInvocationWithMemory("afterFail", context, result),
      );
      return withAgentMetadata(
        parseCommandAgentOutput(agentResult.content),
        agentResult.metadata,
        debugToolCalls,
      );
    },
  };
}

function validateCommandAgentOutput(_input: string, output: string) {
  return parseCommandAgentOutput(output)
    ? undefined
    : "上一次最终输出为空或解析后没有可展示内容。请重新生成一个 JSON 对象，content 字段必须是非空文本；如果没有 suggestedCommand，请输出 null 或空字符串。";
}

function appendDebugOutput(content: string, debugOutput: string) {
  return [content.trim(), debugOutput.trim()].filter(Boolean).join("\n\n");
}

export function compactCommandAgentHistoryEntry(input: string, output: string) {
  const invocation = parseCommandAgentInvocation(input);
  const response = parseCommandAgentOutput(output);
  if (!invocation) {
    return {
      userContent: input,
      assistantContent: output,
    };
  }

  return {
    userContent: JSON.stringify(
      invocation.task === "chat"
        ? {
            task: invocation.task,
            skill: invocation.skill,
            message: (invocation.context as CommandChatContext).message,
          }
        : {
            task: invocation.task,
            skill: invocation.skill,
            command: invocation.context.command,
            rawCommand: invocation.context.rawCommand,
            ...(invocation.result
              ? { result: { exitCode: invocation.result.exitCode } }
              : {}),
          },
    ),
    assistantContent: JSON.stringify({
      content: response?.content ?? output.trim(),
      ...(response?.suggestedCommand ? { suggestedCommand: response.suggestedCommand } : {}),
    }),
  };
}

function parseCommandAgentInvocation(input: string): CommandAgentInvocation | undefined {
  try {
    const parsed = JSON.parse(input) as CommandAgentInvocation;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.task !== "string" ||
      typeof parsed.skill !== "string" ||
      !parsed.context ||
      typeof parsed.context !== "object"
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}
