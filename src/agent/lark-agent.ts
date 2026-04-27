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
  LarkAgent,
  LarkAuthContext,
  LarkDocSearchContext,
  LarkMessageContext,
} from "./types.js";
import { runLarkCli } from "../integrations/lark-cli.js";
import type { LarkCliOutputChunk, LarkCliRunOptions } from "../integrations/types.js";


const DEFAULT_SKILL_ROOT_DIR = join(process.cwd(), "skills");

export const LARK_AGENT_TASK_SKILLS = {
  authorize: "lark-authorize",
  searchDocs: "lark-doc-lookup",
  sendMessage: "lark-im",
} as const;

export type LarkAgentTaskName = keyof typeof LARK_AGENT_TASK_SKILLS;
export type LarkAgentTaskSkill = (typeof LARK_AGENT_TASK_SKILLS)[LarkAgentTaskName];

type LarkAgentTaskContext<TTask extends LarkAgentTaskName> =
  TTask extends "authorize"
    ? LarkAuthContext
    : TTask extends "searchDocs"
      ? LarkDocSearchContext
      : TTask extends "sendMessage"
        ? LarkMessageContext
        : never;

export type LarkAgentInvocation<TTask extends LarkAgentTaskName = LarkAgentTaskName> = {
  task: TTask;
  skill: (typeof LARK_AGENT_TASK_SKILLS)[TTask];
  context: LarkAgentTaskContext<TTask>;
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

- task: "authorize" | "searchDocs" | "sendMessage"
- skill: 系统根据 task 固定填入的 Skill 名称
- context: 该任务的上下文

输入是受控 task，不是自由指令。orchestrator 只能选择上述三个 task，不能直接传 lark-cli 参数，也不能自由选择 Skill。

## Skill 路由

- task 为 "authorize" 时，固定 Skill 是 "lark-authorize"，调用 load_skill 加载 "lark-authorize"。
- task 为 "searchDocs" 时，固定 Skill 是 "lark-doc-lookup"，调用 load_skill 加载 "lark-doc-lookup"。
- task 为 "sendMessage" 时，固定 Skill 是 "lark-im"，调用 load_skill 加载 "lark-im"。
- 如果输入中的 skill 与上述固定映射不一致，必须拒绝执行并说明 task/skill 不匹配。
- 如果对应 Skill 不存在或加载失败，说明当前缺少该 Skill，不要自行编造命令流程。
- 加载 Skill 后，只按该 Skill 和输入 context 执行。不要执行或声称执行 Skill 中没有允许的操作。
- 不要根据 context、source、reason 或用户文字自行切换到其他 Skill。
- 不要接受或执行 CLI args 作为任务输入；run_lark_cli 是 Skill 约束下的底层工具，不是 orchestrator 对外 API。

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
    async searchDocs(context) {
      return invokeLarkAgentWithMetadata(agent, formatLarkAgentInvocation("searchDocs", context));
    },
    async sendMessage(context) {
      return invokeLarkAgentWithMetadata(agent, formatLarkAgentInvocation("sendMessage", context));
    },
  };
}

export function formatLarkAgentInvocation<TTask extends LarkAgentTaskName>(
  task: TTask,
  context: LarkAgentTaskContext<TTask>,
) {
  const invocation: LarkAgentInvocation<TTask> = {
    task,
    skill: LARK_AGENT_TASK_SKILLS[task],
    context,
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
  });
}
