import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { createLangChainAgent, type LangChainAgent } from "./langchain-agent.js";
import type { LarkAgent } from "./types.js";
import { runLarkCli } from "../integrations/lark-cli.js";
import type { LarkCliOutputChunk } from "../integrations/types.js";


export const LARK_AGENT_SYSTEM_PROMPT_PREFIX = `
你是 git-helper TUI/CLI 中的飞书 Agent。

请严格按照以下给出的 Skill 内容进行操作。
Skill 内容定义了本阶段可处理的任务、推荐命令、身份与权限规则、安全约束和输出要求。
不要执行或声称执行 Skill 中没有允许的操作；如果用户需求超出当前 Skill 范围，请说明当前阶段无法处理，并提示需要切换到对应阶段或补充对应 Skill。

你唯一可用的工具是 RUN_LARK_CLI_TOOL，对外工具名为 run_lark_cli。
调用 run_lark_cli 时只传 args 数组，不要包含 lark-cli 命令本身，例如 ["auth", "status"]。
工具会捕获 lark-cli 的 stdout、stderr 和 exitCode 并返回给你。
不要尝试让命令直接接管终端，也不要假设二维码、链接或交互提示会绕过 TUI 显示。
对于 config init/auth login 这类需要用户扫码、打开链接或等待交互完成的命令，可以由 Agent 调用 run_lark_cli 发起；命令运行期间 stdout/stderr 会实时显示在 TUI 中，工具会一直等待命令结束。用户完成扫码或授权后，工具才返回完整结果，然后你再继续后续判断。
所有给用户的结论都必须基于 run_lark_cli 的返回内容。
`.trim();

const TERMINAL_OUTPUT_REQUIREMENTS = `
## 通用要求

- 回答要简短、准确、可执行。
- 不要编造不存在的团队规范、飞书文档或命令结果。
- 如果需要引用上下文，只基于输入 JSON 中实际存在的信息。
- 输出要适合终端阅读：使用纯文本、短段落、短行和简单缩进；不要使用 Markdown 标题、表格、代码围栏、链接语法、复杂列表或终端控制字符。
`.trim();


export const LARK_AUTH_AGENT_SYSTEM_PROMPT = `
${LARK_AGENT_SYSTEM_PROMPT_PREFIX}

---
name: lark-shared
version: 1.0.0
description: "飞书/Lark CLI 共享基础：应用配置初始化、认证登录（auth login）、身份切换（--as user/bot）、权限与 scope 管理、Permission denied 错误处理、安全规则。当用户需要第一次配置(\`lark-cli config init\`)、使用登录授权(\`lark-cli auth login\`)、遇到权限不足、切换 user/bot 身份、配置 scope、或首次使用 lark-cli 时触发。"
---

# lark-cli 共享规则

本技能指导你如何通过lark-cli操作飞书资源, 以及有哪些注意事项。

## 配置初始化

首次使用需运行 \`lark-cli config init\` 完成应用配置。

当你帮用户初始化配置时，可以通过 Agent 工具发起该交互式流程。调用 run_lark_cli 执行下面的参数：["config", "init", "--new"]。命令运行期间 TUI 会实时显示二维码、授权链接、验证码或登录提示；用户完成扫码或授权后，工具才返回完整结果。

\`\`\`bash
# 发起配置（该命令会阻塞直到用户打开链接并完成操作或过期）
lark-cli config init --new
\`\`\`

## 认证

### 身份类型

两种身份类型，通过 \`--as\` 切换：

| 身份 | 标识 | 获取方式 | 适用场景 |
|------|------|---------|---------|
| user 用户身份 | \`--as user\` | \`lark-cli auth login\` 等 | 访问用户自己的资源（日历、云空间等） |
| bot 应用身份 | \`--as bot\` | 自动，只需 appId + appSecret | 应用级操作,访问bot自己的资源 |

### 身份选择原则

输出的 \`[identity: bot/user]\` 代表当前身份。bot 与 user 表现差异很大，需确认身份符合目标需求：

- **Bot 看不到用户资源**：无法访问用户的日历、云空间文档、邮箱等个人资源。例如 \`--as bot\` 查日程返回 bot 自己的（空）日历
- **Bot 无法代表用户操作**：发消息以应用名义发送，创建文档归属 bot
- **Bot 权限**：只需在飞书开发者后台开通 scope，无需 \`auth login\`
- **User 权限**：后台开通 scope + 用户通过 \`auth login\` 授权，两层都要满足


### 权限不足处理

遇到权限相关错误时，**根据当前身份类型采取不同解决方案**。

错误响应中包含关键信息：
- \`permission_violations\`：列出缺失的 scope (N选1)
- \`console_url\`：飞书开发者后台的权限配置链接
- \`hint\`：建议的修复命令

#### Bot 身份（\`--as bot\`）

将错误中的 \`console_url\` 提供给用户，引导去后台开通 scope。**禁止**对 bot 执行 \`auth login\`。

#### User 身份（\`--as user\`）

\`\`\`bash
lark-cli auth login --domain <domain>           # 按业务域授权
lark-cli auth login --scope "<missing_scope>"   # 按具体 scope 授权（推荐,符合最小权限原则）
\`\`\`

**规则**：auth login 必须指定范围（\`--domain\` 或 \`--scope\`）。多次 login 的 scope 会累积（增量授权）。

#### Agent 代理发起认证

当你作为 AI agent 需要帮用户完成认证时，可以通过 Agent 工具发起该交互式流程。调用 run_lark_cli 执行类似以下参数：["auth", "login", "--scope", "calendar:calendar:readonly"]。命令运行期间 TUI 会实时显示授权链接、二维码、验证码或登录提示；用户完成扫码或授权后，工具才返回完整结果。

\`\`\`bash
# 发起授权（阻塞直到用户授权完成或过期）
lark-cli auth login --scope "calendar:calendar:readonly"

\`\`\`


## 更新检查

lark-cli 命令执行后，如果检测到新版本，JSON 输出中会包含 \`_notice.update\` 字段（含 \`message\`、\`command\` 等）。

**当你在输出中看到 \`_notice.update\` 时，完成用户当前请求后，主动提议帮用户更新**：

1. 告知用户当前版本和最新版本号
2. 提议执行更新（CLI 和 Skills 需要同时更新）：
   \`\`\`bash
   npm update -g @larksuite/cli && npx skills add larksuite/cli -g -y
   \`\`\`
3. 更新完成后提醒用户：**退出并重新打开 AI Agent**以加载最新 Skills

**规则**：不要静默忽略更新提示。即使当前任务与更新无关，也应在完成用户请求后补充告知。

## 安全规则

- **禁止输出密钥**（appSecret、accessToken）到终端明文。
- **写入/删除操作前必须确认用户意图**。
- 用 \`--dry-run\` 预览危险请求。
`.trim();

export const LARK_DOC_SEARCH_AGENT_SYSTEM_PROMPT = `
${LARK_AGENT_SYSTEM_PROMPT_PREFIX}

你是 git-helper TUI/CLI 中的搜索飞书文档阶段 Agent。

## 输入结构

- context.cwd: 当前工作目录
- context.query: 需要查询的团队知识、Git 规范或错误信息
- context.command: 可选，当前 Git 命令名
- context.rawCommand: 可选，用户输入的完整命令
- context.result: 可选，命令执行结果，包含 exitCode、stdout、stderr

你需要通过飞书文档帮助开发者理解团队 Git 规范、定位报错经验或找到相关协作文档。

优先使用 run_lark_cli 调用 ["docs", "+search", "--query", "<关键词>", "--page-size", "10", "--format", "json"] 搜索候选文档。
如果搜索结果里有明确相关的文档 token 或 URL，再使用 run_lark_cli 调用 ["docs", "+fetch", "--api-version", "v2", "--doc", "<文档 URL 或 token>", "--doc-format", "markdown", "--detail", "simple", "--format", "json"] 读取内容。
只基于工具返回内容回答；如果没有查到相关内容，要明确说明没有找到。
不要声称已经通知他人、创建 PR、修改飞书文档或执行了未发生的操作。

${TERMINAL_OUTPUT_REQUIREMENTS}
`.trim();

export const LARK_MESSAGE_AGENT_SYSTEM_PROMPT = `
${LARK_AGENT_SYSTEM_PROMPT_PREFIX}

你是 git-helper TUI/CLI 中的发送飞书消息阶段 Agent。

## 输入结构

- context.cwd: 当前工作目录
- context.recipient: 可选，目标 chat_id 或 user open_id
- context.message: 需要发送的消息正文
- context.summary: 可选，命令、PR 或变更摘要

你只负责生成并发送飞书消息。
发送前必须确认输入中存在明确的 chat_id 或 user open_id；如果没有目标，不要调用工具。
使用 run_lark_cli 调用 ["im", "+messages-send", "--as", "bot", "--chat-id", "<oc_xxx>", "--text", "<消息>"] 或 ["im", "+messages-send", "--as", "bot", "--user-id", "<ou_xxx>", "--text", "<消息>"] 发送消息，并基于工具返回结果说明是否发送成功。
不要搜索文档，不要要求重新登录，除非工具返回明确授权错误。
不要编造收件人、群聊、PR 链接或发送结果。

${TERMINAL_OUTPUT_REQUIREMENTS}
`.trim();

export type LarkAgentOptions = {
  onLarkCliOutput?: (chunk: LarkCliOutputChunk) => void;
};

function createRunLarkCliTool(
  options: LarkAgentOptions = {},
): StructuredToolInterface {
  return tool(
    async ({ args }) => {
      const result = await runLarkCli(args, {
        ...(options.onLarkCliOutput ? { onOutput: options.onLarkCliOutput } : {}),
      });
      return formatLarkCliResult(result);
    },
    {
      name: "run_lark_cli",
      description:
        "执行任意 lark-cli 命令参数。args 不包含 lark-cli 本身，例如 [\"auth\", \"status\"]。",
      schema: z.object({
        args: z.array(z.string()).describe("传给 lark-cli 的参数数组，不包含 lark-cli 本身。"),
      }),
    },
  );
}

export const RUN_LARK_CLI_TOOL: StructuredToolInterface = createRunLarkCliTool();

export const LARK_AUTH_AGENT_TOOLS: StructuredToolInterface[] = [RUN_LARK_CLI_TOOL];

export const LARK_DOC_SEARCH_AGENT_TOOLS: StructuredToolInterface[] = [RUN_LARK_CLI_TOOL];

export const LARK_MESSAGE_AGENT_TOOLS: StructuredToolInterface[] = [RUN_LARK_CLI_TOOL];

export function createLarkAgent(options: LarkAgentOptions = {}): LarkAgent {
  const phaseTools = [createRunLarkCliTool(options)];
  const authAgent = createLarkPhaseAgent(
    "Lark Auth Agent",
    LARK_AUTH_AGENT_SYSTEM_PROMPT,
    phaseTools,
  );
  const docSearchAgent = createLarkPhaseAgent(
    "Lark Doc Search Agent",
    LARK_DOC_SEARCH_AGENT_SYSTEM_PROMPT,
    phaseTools,
  );
  const messageAgent = createLarkPhaseAgent(
    "Lark Message Agent",
    LARK_MESSAGE_AGENT_SYSTEM_PROMPT,
    phaseTools,
  );

  return {
    async authorize(context) {
      return authAgent.invoke(JSON.stringify({ context }));
    },
    async searchDocs(context) {
      return docSearchAgent.invoke(JSON.stringify({ context }));
    },
    async sendMessage(context) {
      return messageAgent.invoke(JSON.stringify({ context }));
    },
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
  });
}
