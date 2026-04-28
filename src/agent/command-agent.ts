import { execFile } from "node:child_process";
import { join } from "node:path";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { providerStrategy } from "langchain";
import { z } from "zod";

import type {
  AgentRunMetadata,
  CommandAgent,
  CommandContext,
  CommandAgentOutput,
  LarkAgent,
} from "./types.js";
import { createLangChainAgent, createLangChainChatModel } from "./runtime/langchain-agent.js";
import {
  createSkillRegistry,
  formatAvailableSkills,
  type SkillRegistry,
} from "./skill-registry.js";
import { readTldrPage } from "../integrations/tldr.js";

const DEFAULT_SKILL_ROOT_DIR = join(process.cwd(), "skills");

export const COMMAND_AGENT_TASK_SKILLS = {
  help: "command-help",
  commitMessage: "command-git-commit-message",
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
};

const TERMINAL_OUTPUT_REQUIREMENTS = `
## 通用要求

- 回答要简短、准确、可执行。
- 不要编造不存在的团队规范、飞书文档或命令结果。
- 如果需要引用上下文，只基于输入 JSON 中实际存在的信息。
- 输出要适合终端阅读：使用纯文本、短段落、短行和简单缩进；不要使用 Markdown 标题、表格、代码围栏、链接语法、复杂列表或终端控制字符。
- 只能输出一个 JSON 对象，不要输出 JSON 之外的任何文字。
- JSON 必须包含 content 字段；content 是展示给用户的终端文本。
- suggestedCommand 可选；如果输出 suggestedCommand，它必须是一条完整命令，不是命令后缀。如果没有明确可执行建议，输出空字符串或省略。
- 可以大胆给出 suggestedCommand，用户不一定会接受；它只是 TUI 里的高优先级补全候选。只要有一个合理、完整、可执行的下一步命令，就给出 suggestedCommand；如果当前信息不足或建议可能危险，才输出空字符串。
- Command Agent 不直接调用 Lark Agent，不直接执行 Lark CLI，也不输出 callLarkAgent、agent、toolName 等执行字段。
- 当回答需要获取团队飞书文档内容、团队规范、流程或约定来改进结果时，调用 request_lark_context 工具；该工具只接受受控 topic，不接受 lark-cli args。
- 当前 phase 不会等待用户确认。需要用户确认的协作动作只能作为 followUpActions 输出，确认必须来自后续显式动作。
- push、PR、review 等通知类建议只输出 followUpActions；不要声称已经发送飞书消息。
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

## Skill 路由

- task 为 "help" 时，固定 Skill 是 "command-help"，调用 load_skill 加载 "command-help"。
- task 为 "commitMessage" 时，固定 Skill 是 "command-git-commit-message"，调用 load_skill 加载 "command-git-commit-message"。
- 如果输入中的 skill 与上述固定映射不一致，必须拒绝执行并说明 task/skill 不匹配。
- 如果对应 Skill 不存在或加载失败，说明当前缺少该 Skill，不要自行编造命令流程。
- 处理任务前必须先调用 load_skill 读取对应 Skill。
- 加载 Skill 后，只按该 Skill 和输入 context 执行；不要自行切换到其他 Skill。
- 如果 Skill 要求调用工具，必须按 Skill 规定的顺序和参数调用。
当回答需要获取团队飞书文档内容、团队规范、流程或约定来改进结果时，调用 request_lark_context 工具；该工具只接受受控 topic，不接受 lark-cli args。

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
- context.tuiSession: 当前 TUI 顶部状态栏对应的会话快照；包含 cwd、git、lark 结构化状态，以及 header.cwd、header.gitSummary、header.larkSummary 三段顶部展示文本；git 里可能包含 branches.local、branches.remote 和 remotes(fetchUrl、pushUrl、webUrl)
- result.exitCode: 命令退出码
- result.stdout: 命令标准输出
- result.stderr: 命令错误输出

## Task 用户刚成功执行了关键 Git 命令，需要下一步建议

关键 Git 命令已经成功执行。你需要给出非常短的下一步建议，帮助用户继续推进工作。

不要复述成功输出，不要解释已经成功的事实。
根据命令类型给出 1-3 条可执行提醒：
push 后，提醒是否需要打开 PR、通知维护者或检查远端状态。
commit 后，提醒是否需要 push、继续拆分提交或查看状态。
pull、merge、rebase 后，提醒检查 git status，并按项目习惯运行必要测试。
如果 context.tuiSession 存在，可以结合 context.tuiSession.git 的 branch、upstream、dirty 状态，branches 中实际存在的分支，以及 remotes 中的 fetchUrl、pushUrl、webUrl 给出更贴近当前环境的提醒；push 成功后如果存在可识别 webUrl，可以在 content 中给出仓库链接，方便用户继续打开 PR；不要编造不存在的远端、分支、登录身份或文件名。

## Task 用户可能需要一条可直接补全的建议命令

如果能判断出合理的下一步，把它放进 suggestedCommand，例如 push 后建议查看远端或打开 PR 前的检查命令，commit 后建议 git push，pull、merge、rebase 后建议 git status 或项目测试命令。不要建议会破坏工作区或需要额外确认的危险命令。

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

## Task 用户的命令执行失败，需要排查帮助

根据失败结果给出非常短的排查方向或下一步命令。
优先参考 result.stderr，其次参考 result.stdout 和 rawCommand。
不要假设没有出现在输入中的仓库状态、远端状态或团队规范。

## Task 用户可能需要一条可直接补全的修复或排查命令

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

type RequestLarkContextToolOptions = {
  larkAgent?: Pick<LarkAgent, "requestContext"> | undefined;
};

type CommandAgentToolOptions = RequestLarkContextToolOptions & {
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

export function createRequestLarkContextTool({
  larkAgent,
}: RequestLarkContextToolOptions = {}): StructuredToolInterface {
  return tool(
    async ({
      topic,
      cwd,
      reason,
      command,
      rawCommand,
      repository,
    }) => {
      if (!larkAgent) {
        return JSON.stringify({
          topic,
          content: "",
          freshness: "missing",
        });
      }

      const compactRepository = compactLarkContextRepository(repository);
      return JSON.stringify(
        await larkAgent.requestContext({
          topic,
          cwd,
          reason,
          ...(command ? { command } : {}),
          ...(rawCommand ? { rawCommand } : {}),
          ...(compactRepository ? { repository: compactRepository } : {}),
        }),
      );
    },
    {
      name: "request_lark_context",
      description:
        "向 Lark Agent 请求受控飞书上下文。只接受固定 topic，不接受 lark-cli args；用于在 Command Agent 生成最终回答前获取团队规范。",
      schema: z
        .object({
          topic: z.literal("commit_message_policy").describe("需要的飞书上下文主题。"),
          cwd: z.string().describe("当前工作目录，必须使用输入 context.cwd。"),
          reason: z.string().describe("请求该上下文的原因。"),
          command: z.string().optional(),
          rawCommand: z.string().optional(),
          repository: z
            .object({
              root: z.string().optional(),
              remoteUrl: z.string().optional(),
              webUrl: z.string().optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    },
  );
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
    createRequestLarkContextTool(options),
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
) {
  const invocation: CommandAgentInvocation<TTask> = {
    task,
    skill: COMMAND_AGENT_TASK_SKILLS[task],
    context,
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

const COMMAND_AGENT_FOLLOW_UP_ACTION_SCHEMA = z
  .object({
    type: z.literal("collaboration.notification"),
    reason: z.string(),
    title: z.string(),
    draftMessage: z.string(),
    confirmationMode: z.literal("explicit_followup"),
  })
  .strict();

export const COMMAND_AGENT_OUTPUT_SCHEMA = z
  .object({
    content: z.string(),
    suggestedCommand: z.string().optional(),
    followUpActions: z.array(COMMAND_AGENT_FOLLOW_UP_ACTION_SCHEMA).optional(),
  })
  .strict();

const COMMAND_AGENT_RESPONSE_SCHEMA = z
  .object({
    content: z.string(),
    suggestedCommand: z.string().optional(),
    followUpActions: z.array(COMMAND_AGENT_FOLLOW_UP_ACTION_SCHEMA).optional(),
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
        ...(validated.data.followUpActions
          ? { followUpActions: validated.data.followUpActions }
          : {}),
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
  larkAgent?: Pick<LarkAgent, "requestContext"> | undefined;
  skillRegistry?: SkillRegistry | undefined;
  skillRootDir?: string | undefined;
};

export function createCommandAgent(options: CommandAgentOptions = {}): CommandAgent {
  const skillRegistry =
    options.skillRegistry ??
    createSkillRegistry({
      rootDir: options.skillRootDir ?? DEFAULT_SKILL_ROOT_DIR,
      namePrefixes: ["command-"],
    });
  const model = createLangChainChatModel({ modelRole: "command" });
  const helpAgent = createLangChainAgent({
    name: "Command Help Agent",
    systemPrompt: HELP_AGENT_SYSTEM_PROMPT,
    tools: createCommandAgentTools({
      larkAgent: options.larkAgent,
      skillRegistry,
    }),
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
      const result = await helpAgent.invokeWithMetadata(
        formatCommandAgentInvocation(routeCommandAgentTask(context), context),
      );
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
