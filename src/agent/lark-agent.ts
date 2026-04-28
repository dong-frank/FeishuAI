import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { join } from "node:path";

import {
  createLangChainAgent,
  createLangChainChatModel,
  type LangChainAgent,
} from "./runtime/langchain-agent.js";
import {
  createSkillRegistry,
  formatAvailableSkills,
  type SkillRegistry,
} from "./skill-registry.js";
import type {
  CommandAgentOutput,
  LarkAgent,
  LarkAuthContext,
  LarkContextPack,
  LarkContextRequest,
  LarkInteractionRequest,
} from "./types.js";
import { runLarkCli } from "../integrations/lark-cli.js";
import type { LarkCliOutputChunk, LarkCliRunOptions } from "../integrations/types.js";


const DEFAULT_SKILL_ROOT_DIR = join(process.cwd(), "skills");

export const LARK_AGENT_TASK_SKILLS = {
  authorize: "lark-authorize",
} as const;

export const LARK_AGENT_INTERACTION_SKILLS = {
  get_context: "lark-doc-lookup",
  send_message: "lark-im",
  write_development_record: "lark-doc-write",
} as const;

export type LarkAgentTaskName = keyof typeof LARK_AGENT_TASK_SKILLS;
export type LarkAgentTaskSkill = (typeof LARK_AGENT_TASK_SKILLS)[LarkAgentTaskName];

export type LarkAgentInteractionAction = keyof typeof LARK_AGENT_INTERACTION_SKILLS;
export type LarkAgentInteractionSkill =
  (typeof LARK_AGENT_INTERACTION_SKILLS)[LarkAgentInteractionAction];

export type LarkAgentInvocation =
  | {
      task: "authorize";
      skill: (typeof LARK_AGENT_TASK_SKILLS)["authorize"];
      context: LarkAuthContext;
    }
  | {
      task: "interact";
      skill: LarkAgentInteractionSkill;
      context: LarkInteractionRequest;
    };

export const LARK_AGENT_SYSTEM_PROMPT = `
你是 git-helper TUI/CLI 中的单一飞书 Agent。

## 工具

你可以使用两个工具：

1. load_skill
   - 按需加载本地 Skill.md 内容。
   - 处理任何 task 前，先用 load_skill 读取对应 Skill，再按 Skill 约束操作。
   - Skill 内容定义推荐命令、身份与权限规则、安全约束和输出要求。

2. run_lark_cli
   - 执行 lark-cli 参数。
调用 run_lark_cli 时传 args 数组和 showOutputInTui 布尔值；args 不要包含 lark-cli 命令本身，例如 ["auth", "status"]。
工具会捕获 lark-cli 的 stdout、stderr 和 exitCode 并返回给你。
showOutputInTui 默认 false：用于内部探测、状态判断、后续要由 Agent 摘要的 JSON 结果，避免把中间数据刷到 TUI 历史界面。
当命令需要用户扫码、打开链接、等待交互完成，或命令输出本身就是用户需要直接查看的结果时，可以设置 showOutputInTui 为 true；命令运行期间 stdout/stderr 会实时显示在 TUI 中，工具会一直等待命令结束。
如果设置 showOutputInTui 为 true，必须为该命令选择适合人阅读或管道消费的输出格式，并把对应 --format 参数放入 args：
- --format json：完整 JSON 响应，适合 Agent 内部读取和精确判断，也是 lark-cli 默认格式；除非用户明确需要看原始 JSON，否则通常不要配合 showOutputInTui: true。
- --format pretty：人性化格式输出，适合在 TUI 中直接展示给用户。
- --format table：易读表格，适合列表、搜索结果、记录集合。
- --format ndjson：换行分隔 JSON，适合管道处理或持续事件流。
- --format csv：逗号分隔值，适合表格数据导出或用户要求 CSV。
对于 config init/auth login 这类交互命令，如果命令不支持 --format，也可以不加 --format，但仍应设置 showOutputInTui: true，以便用户看到授权链接、二维码、验证码或登录提示。
所有给用户的结论都必须基于 run_lark_cli 的返回内容。

## 输入结构

用户消息是 JSON 字符串，格式为：

- task: "authorize" | "interact"
- skill: 系统根据 task 固定填入的 Skill 名称
- context: 该任务的上下文

输入是受控 task 和受控 action，不是自由指令。调用方只能选择上述 task 和允许的 interact action，不能直接传 lark-cli 参数，也不能自由选择 Skill。

## Skill 路由

- task 为 "authorize" 时，固定 Skill 是 "lark-authorize"，调用 load_skill 加载 "lark-authorize"。
- task 为 "interact" 时，根据 context.action 固定选择 Skill：
  - action 为 "get_context" 时，固定 Skill 是 "lark-doc-lookup"，调用 load_skill 加载 "lark-doc-lookup"。
  - action 为 "send_message" 时，固定 Skill 是 "lark-im"，调用 load_skill 加载 "lark-im"。
  - action 为 "write_development_record" 时，固定 Skill 是 "lark-doc-write"，调用 load_skill 加载 "lark-doc-write"。


## interact 输出

action 为 "get_context" 时，用来把飞书侧上下文返回给 Command Agent，而不是直接展示给用户。
目前支持的 topic 是 "commit_message_policy" 和 "troubleshooting_reference"。
topic 为 "commit_message_policy" 时，查询或返回团队 commit message 规范；这类内容只影响提交信息的风格、格式、前缀和粒度。
topic 为 "troubleshooting_reference" 时，查询或返回团队排障参考；这类内容只用于解释命令失败、定位错误和建议下一步检查。
如果本 Agent 当前会话历史中已经知道同一个 topic 的可用资料，直接返回 remembered，不要重复查询。
如果历史中没有同一个 topic 的可用资料，按 lark-doc-lookup Skill 搜索和读取相关文档，返回 refreshed。
如果找不到或无权限，返回 missing，不要编造团队规范或排障方法。
不要把 commit 规范当作排障方法，也不要把排障资料当作 commit 规范。
get_context 必须只输出一个 JSON 对象：
- topic: "commit_message_policy" | "troubleshooting_reference"
- content: 字符串
- freshness: "remembered" | "refreshed" | "missing"
- source 可选，包含 title、url 或 documentId
- updatedAt 可选，使用 ISO 时间字符串

action 为 "write_development_record" 时，用来写入团队开发记录文档。按 lark-doc-write Skill 搜索、读取并更新文档，输出一个 JSON 对象：
- content: 字符串，说明文档位置、写入摘要，或未写入原因
- suggestedCommand 可选，一般省略

action 为 "send_message" 时，按 lark-im Skill 发送消息，输出一个 JSON 对象：
- content: 字符串，说明发送结果
- suggestedCommand 可选，一般省略

## 通用要求

- 回答要简短、准确、可执行。
- 不要编造不存在的团队规范、飞书文档或命令结果。
- 如果需要引用上下文，只基于输入 JSON 中实际存在的信息。
- 输出要适合终端阅读：使用纯文本、短段落、短行和简单缩进；不要使用 Markdown 标题、表格、代码围栏、链接语法、复杂列表或终端控制字符。
`.trim();

export type LarkAgentOptions = {
  onLarkCliOutput?: (chunk: LarkCliOutputChunk) => void;
  runLarkCli?: (args: string[], options?: LarkCliRunOptions) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  skillRootDir?: string;
  skillRegistry?: SkillRegistry;
};

export function createRunLarkCliTool(
  options: LarkAgentOptions = {},
): StructuredToolInterface {
  return tool(
    async ({ args, showOutputInTui = false }) => {
      const executeRunLarkCli = options.runLarkCli ?? runLarkCli;
      const result = await executeRunLarkCli(args, {
        ...(showOutputInTui && options.onLarkCliOutput
          ? { onOutput: options.onLarkCliOutput }
          : {}),
      });
      return formatLarkCliResult(result);
    },
    {
      name: "run_lark_cli",
      description:
        "执行任意 lark-cli 命令参数。args 不包含 lark-cli 本身，例如 [\"auth\", \"status\"]。showOutputInTui 表示是否把命令运行期间输出实时显示到 TUI 历史界面；展示给用户时应选择合适的 --format。",
      schema: z.object({
        args: z.array(z.string()).describe("传给 lark-cli 的参数数组，不包含 lark-cli 本身。"),
        showOutputInTui: z
          .boolean()
          .default(false)
          .describe("是否把命令运行期间的 stdout/stderr 实时显示在 TUI 历史界面。"),
      }),
    },
  );
}

function createLoadSkillTool(registry: SkillRegistry): StructuredToolInterface {
  return tool(
    async ({ skillName }) => registry.loadSkill(skillName),
    {
      name: "load_skill",
      description: `Load a specialized Lark skill.

Available skills:
${formatAvailableSkills(registry.listSkills())}

Returns the skill's prompt and context.`,
      schema: z.object({
        skillName: z.string().describe("Name of skill to load"),
      }),
    },
  );
}

const DEFAULT_SKILL_REGISTRY = createSkillRegistry({
  rootDir: DEFAULT_SKILL_ROOT_DIR,
});

export const RUN_LARK_CLI_TOOL: StructuredToolInterface = createRunLarkCliTool();

export const LOAD_SKILL_TOOL: StructuredToolInterface = createLoadSkillTool(
  DEFAULT_SKILL_REGISTRY,
);

export const LARK_AGENT_TOOLS: StructuredToolInterface[] = [
  LOAD_SKILL_TOOL,
  RUN_LARK_CLI_TOOL,
];

export function createLarkAgent(options: LarkAgentOptions = {}): LarkAgent {
  const registry =
    options.skillRegistry ??
    createSkillRegistry({
      rootDir: options.skillRootDir ?? DEFAULT_SKILL_ROOT_DIR,
    });
  const agent = createLarkPhaseAgent("Lark Agent", LARK_AGENT_SYSTEM_PROMPT, [
    createLoadSkillTool(registry),
    createRunLarkCliTool(options),
  ]);

  return {
    async authorize(context) {
      return invokeLarkAgentWithMetadata(agent, formatLarkAgentInvocation("authorize", context));
    },
    async interact(context) {
      const result = await agent.invokeWithMetadata(formatLarkAgentInvocation("interact", context));
      return parseLarkInteractionResult(context, result.content, result.metadata);
    },
  };
}

const LARK_CONTEXT_PACK_SCHEMA = z
  .object({
    topic: z.enum(["commit_message_policy", "troubleshooting_reference"]),
    content: z.string(),
    freshness: z.enum(["remembered", "refreshed", "missing"]),
    source: z
      .object({
        title: z.string().optional(),
        url: z.string().optional(),
        documentId: z.string().optional(),
      })
      .strict()
      .optional(),
    updatedAt: z.string().optional(),
  })
  .strict();

function parseLarkContextPack(
  output: string,
  topic: LarkContextRequest["topic"],
): LarkContextPack {
  const trimmed = output.trim();
  if (!trimmed) {
    return {
      topic,
      content: "",
      freshness: "missing",
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    const validated = LARK_CONTEXT_PACK_SCHEMA.safeParse(parsed);
    if (validated.success) {
      const data = validated.data;
      return {
        topic: data.topic,
        content: data.content,
        freshness: data.freshness,
        ...(data.source ? { source: compactLarkContextSource(data.source) } : {}),
        ...(data.updatedAt ? { updatedAt: data.updatedAt } : {}),
      };
    }
  } catch {
    // Fall through to text compatibility for early skill iterations.
  }

  return {
    topic,
    content: trimmed,
    freshness: "refreshed",
  };
}

const LARK_COMMAND_OUTPUT_SCHEMA = z
  .object({
    content: z.string(),
    suggestedCommand: z.string().optional(),
  })
  .strict();

export function parseLarkInteractionResult(
  context: LarkInteractionRequest,
  output: string,
  metadata?: CommandAgentOutput["metadata"],
) {
  if (context.action === "get_context") {
    return parseLarkContextPack(output, context.topic);
  }

  const trimmed = output.trim();
  if (!trimmed) {
    return {
      content: "",
      ...(metadata ? { metadata } : {}),
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    const validated = LARK_COMMAND_OUTPUT_SCHEMA.safeParse(parsed);
    if (validated.success) {
      const content = validated.data.content.trim();
      const suggestedCommand = validated.data.suggestedCommand?.trim() ?? "";
      return {
        content,
        ...(suggestedCommand ? { suggestedCommand } : {}),
        ...(metadata ? { metadata } : {}),
      };
    }
  } catch {
    // Fall through to text compatibility for early skill iterations.
  }

  return {
    content: trimmed,
    ...(metadata ? { metadata } : {}),
  };
}

function compactLarkContextSource(source: {
  title?: string | undefined;
  url?: string | undefined;
  documentId?: string | undefined;
}) {
  return {
    ...(source.title ? { title: source.title } : {}),
    ...(source.url ? { url: source.url } : {}),
    ...(source.documentId ? { documentId: source.documentId } : {}),
  };
}

export function formatLarkAgentInvocation(
  task: "authorize",
  context: LarkAuthContext,
): string;
export function formatLarkAgentInvocation(
  task: "interact",
  context: LarkInteractionRequest,
): string;
export function formatLarkAgentInvocation(
  task: "authorize" | "interact",
  context: LarkAuthContext | LarkInteractionRequest,
) {
  const invocation: LarkAgentInvocation =
    task === "authorize"
      ? {
          task,
          skill: LARK_AGENT_TASK_SKILLS.authorize,
          context: context as LarkAuthContext,
        }
      : {
          task,
          skill: LARK_AGENT_INTERACTION_SKILLS[
            (context as LarkInteractionRequest).action
          ],
          context: context as LarkInteractionRequest,
        };
  return JSON.stringify(invocation);
}

async function invokeLarkAgentWithMetadata(agent: LangChainAgent, input: string) {
  const result = await agent.invokeWithMetadata(input);
  return {
    content: result.content.trim(),
    metadata: result.metadata,
  };
}

function formatLarkCliResult(result: {
  exitCode: number;
  stdout: string;
  stderr: string;
}) {
  return JSON.stringify(result);
}

function createLarkPhaseAgent(
  name: string,
  systemPrompt: string,
  tools: StructuredToolInterface[],
): LangChainAgent {
  return createLangChainAgent({
    name,
    systemPrompt,
    tools,
    model: createLangChainChatModel({ modelRole: "lark" }),
    preserveHistory: true,
  });
}
