import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, type ResponseFormat, type TypedToolStrategy } from "langchain";
import { traceable } from "langsmith/traceable";

import type { AgentContextUsage, AgentRunMetadata, AgentTokenUsage } from "../types.js";

export type LangChainChatModelConfig = {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  modelRole?: LangChainModelRole;
  disableThinking?: boolean;
  modelKwargs?: Record<string, unknown>;
};

export type LangChainModelRole = "default" | "command" | "lark";

export type LangChainAgentOptions = {
  systemPrompt: string;
  tools?: StructuredToolInterface[];
  model?: ChatOpenAI;
  name?: string;
  responseFormat?: LangChainResponseFormat | undefined;
  preserveHistory?: boolean;
  compactHistoryEntry?: LangChainHistoryCompactor | undefined;
};

export type LangChainAgent = {
  systemPrompt: string;
  tools: StructuredToolInterface[];
  responseFormat?: LangChainResponseFormat | undefined;
  invoke: (input: string) => Promise<string>;
  invokeWithMetadata: (input: string) => Promise<LangChainAgentInvokeResult>;
};

export type LangChainResponseFormat = ResponseFormat | TypedToolStrategy<unknown>;

export type LangChainAgentInvokeResult = {
  content: string;
  metadata: AgentRunMetadata;
};

export type LangChainHistoryCompactor = (
  input: string,
  output: string,
) => {
  userContent: string;
  assistantContent: string;
};

export function createLangChainChatModel(config: LangChainChatModelConfig = {}) {
  const disableThinking = config.disableThinking ?? true;

  return new ChatOpenAI({
    apiKey: config.apiKey ?? process.env.API_KEY ?? "",
    model: config.model ?? resolveLangChainModelName(config.modelRole, process.env),
    temperature: 0.7,
    modelKwargs: {
      ...(disableThinking ? { thinking: { type: "disabled" } } : {}),
      ...config.modelKwargs,
    },
    configuration: {
      baseURL:
        config.baseURL ?? process.env.BASE_URL ?? "",
    },
  });
}

export function resolveLangChainModelName(
  modelRole: LangChainModelRole = "default",
  env: NodeJS.ProcessEnv = process.env,
) {
  if (modelRole === "command") {
    return env.COMMAND_MODEL ?? env.MODEL ?? "";
  }

  if (modelRole === "lark") {
    return env.LARK_MODEL ?? env.MODEL ?? "";
  }

  return env.MODEL ?? "";
}

export function createLangChainAgent(options: LangChainAgentOptions): LangChainAgent {
  const tools = options.tools ?? [];
  const model = options.model ?? createLangChainChatModel();
  const agent = createAgent({
    model,
    tools,
    systemPrompt: options.systemPrompt,
    ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
  });
  const name = options.name ?? "LangChain Agent";
  let messageHistory: any[] = [];
  const invokeWithMetadata = async (input: string) => {
    const startedAt = Date.now();
    const messages = [
      ...(options.preserveHistory ? messageHistory : []),
      { role: "user", content: input },
    ];
    const result = await agent.invoke({
      messages,
    });
    const content = getLangChainAgentOutputText(result);
    if (options.preserveHistory) {
      const historyEntry = compactLangChainHistoryEntry(input, content, options.compactHistoryEntry);
      messageHistory = [
        ...messageHistory,
        { role: "user", content: historyEntry.userContent },
        { role: "assistant", content: historyEntry.assistantContent },
      ];
    }
    const contextMessages = options.preserveHistory
      ? messageHistory
      : [
          ...messages,
          { role: "assistant", content },
        ];
    const durationMs = Date.now() - startedAt;

    return {
      content,
      metadata: {
        ...extractLangChainAgentMetadata(result, durationMs),
        contextUsage: summarizeAgentContextUsage(contextMessages),
      },
    };
  };
  const invoke = async (input: string) => {
    const result = await invokeWithMetadata(input);
    return result.content;
  };

  return {
    systemPrompt: options.systemPrompt,
    tools,
    ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
    invoke: shouldTraceLangChainAgent(process.env)
      ? traceable(invoke, {
          name,
          run_type: "chain",
        })
      : invoke,
    invokeWithMetadata: shouldTraceLangChainAgent(process.env)
      ? traceable(invokeWithMetadata, {
          name,
          run_type: "chain",
        })
      : invokeWithMetadata,
  };
}

function compactLangChainHistoryEntry(
  input: string,
  output: string,
  compactor: LangChainHistoryCompactor | undefined,
) {
  return compactor?.(input, output) ?? {
    userContent: input,
    assistantContent: output,
  };
}

export function shouldTraceLangChainAgent(env: NodeJS.ProcessEnv) {
  return env.NODE_ENV !== "test";
}

export function getLangChainAgentOutputText(result: unknown): string {
  if (isRecord(result) && "structuredResponse" in result) {
    return stringifyContent(result.structuredResponse);
  }

  if (!isRecord(result) || !Array.isArray(result.messages)) {
    return stringifyContent(result);
  }

  const lastMessage = result.messages.at(-1);
  if (!isRecord(lastMessage) || !("content" in lastMessage)) {
    return stringifyContent(lastMessage);
  }

  return stringifyContent(lastMessage.content);
}

export function extractLangChainAgentMetadata(
  result: unknown,
  durationMs: number,
): AgentRunMetadata {
  const tokenUsage = extractLangChainTokenUsage(result);
  const rawToolCalls = extractLangChainAgentToolCalls(result);
  return {
    durationMs: Math.max(0, Math.round(durationMs)),
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(rawToolCalls.length > 0 ? { rawToolCalls } : {}),
    rawAgentResult: formatRawAgentResult(result),
  };
}

export function summarizeAgentContextUsage(messages: unknown[]): AgentContextUsage {
  const characterCount = messages
    .filter(isRecord)
    .map((message) => stringifyContent(message.content))
    .reduce((total, content) => total + content.length, 0);

  return {
    messageCount: messages.length,
    characterCount,
    estimatedTokens: Math.ceil(characterCount / 4),
  };
}

function extractLangChainTokenUsage(result: unknown): AgentTokenUsage | undefined {
  const messages = isRecord(result) && Array.isArray(result.messages)
    ? result.messages
    : [];
  return messages
    .filter(isRecord)
    .map(readMessageTokenUsage)
    .filter((usage): usage is AgentTokenUsage => Boolean(usage))
    .reduce<AgentTokenUsage | undefined>(sumTokenUsage, undefined);
}

export function extractLangChainAgentToolCalls(result: unknown): unknown[] {
  const messages = isRecord(result) && Array.isArray(result.messages)
    ? result.messages
    : [];

  return messages.flatMap((message) => {
    if (!isRecord(message)) {
      return [];
    }

    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls
      : Array.isArray(message.toolCalls)
        ? message.toolCalls
        : Array.isArray(getNested(message, ["additional_kwargs", "tool_calls"]))
          ? getNested(message, ["additional_kwargs", "tool_calls"])
          : [];

    return Array.isArray(toolCalls) ? toolCalls : [];
  });
}

export function formatRawToolCallsDebugOutput(
  rawToolCalls: unknown[] | undefined,
  rawAgentResult?: string | undefined,
) {
  if (!rawToolCalls?.length && !rawAgentResult) {
    return "";
  }

  try {
    const rawToolCallsText = JSON.stringify(rawToolCalls ?? [], null, 2);
    return [
      `raw_tool_calls:\n${rawToolCallsText}`,
      rawAgentResult ? `raw_agent_result:\n${rawAgentResult}` : "",
    ].filter(Boolean).join("\n\n");
  } catch {
    return `raw_tool_calls:\n${String(rawToolCalls)}`;
  }
}

function formatRawAgentResult(result: unknown) {
  return truncateDebugText(safeStringify(summarizeAgentResult(result), 2), 12_000);
}

function summarizeAgentResult(result: unknown) {
  if (!isRecord(result)) {
    return result;
  }

  return {
    ...(result.structuredResponse !== undefined
      ? { structuredResponse: result.structuredResponse }
      : {}),
    ...(Array.isArray(result.messages)
      ? { messages: result.messages.map(summarizeAgentMessage) }
      : {}),
    keys: Object.keys(result),
  };
}

function summarizeAgentMessage(message: unknown) {
  if (!isRecord(message)) {
    return message;
  }

  return {
    ...(message.id !== undefined ? { id: message.id } : {}),
    ...(message.name !== undefined ? { name: message.name } : {}),
    ...(message.content !== undefined ? { content: message.content } : {}),
    ...(message.tool_calls !== undefined ? { tool_calls: message.tool_calls } : {}),
    ...(message.toolCalls !== undefined ? { toolCalls: message.toolCalls } : {}),
    ...(message.additional_kwargs !== undefined
      ? { additional_kwargs: message.additional_kwargs }
      : {}),
    ...(message.response_metadata !== undefined
      ? { response_metadata: message.response_metadata }
      : {}),
    ...(message.usage_metadata !== undefined ? { usage_metadata: message.usage_metadata } : {}),
    keys: Object.keys(message),
  };
}

function safeStringify(value: unknown, space?: number) {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, nestedValue) => {
      if (typeof nestedValue === "object" && nestedValue !== null) {
        if (seen.has(nestedValue)) {
          return "[Circular]";
        }
        seen.add(nestedValue);
      }
      return nestedValue;
    },
    space,
  );
}

function truncateDebugText(text: string, limit: number) {
  return text.length > limit
    ? `${text.slice(0, limit)}\n... [truncated ${text.length - limit} chars]`
    : text;
}

function readMessageTokenUsage(message: Record<string, unknown>): AgentTokenUsage | undefined {
  return (
    readUsageMetadata(message.usage_metadata) ??
    readOpenAiTokenUsage(getNested(message, ["response_metadata", "tokenUsage"])) ??
    readOpenAiUsage(getNested(message, ["response_metadata", "usage"])) ??
    readOpenAiUsage(getNested(message, ["response_metadata", "token_usage"])) ??
    readOpenAiUsage(message.token_usage)
  );
}

function sumTokenUsage(
  total: AgentTokenUsage | undefined,
  next: AgentTokenUsage,
): AgentTokenUsage {
  if (!total) {
    return next;
  }

  return {
    totalTokens: total.totalTokens + next.totalTokens,
  };
}

function readUsageMetadata(value: unknown): AgentTokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return compactTokenUsage(readNumber(value.total_tokens));
}

function readOpenAiTokenUsage(value: unknown): AgentTokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return compactTokenUsage(readNumber(value.totalTokens));
}

function readOpenAiUsage(value: unknown): AgentTokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return compactTokenUsage(readNumber(value.total_tokens));
}

function compactTokenUsage(totalTokens: number | undefined): AgentTokenUsage | undefined {
  return typeof totalTokens === "number" ? { totalTokens } : undefined;
}

function getNested(value: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[key];
  }, value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map(stringifyContentBlock).filter(Boolean).join("\n");
  }

  if (content == null) {
    return "";
  }

  return JSON.stringify(content);
}

function stringifyContentBlock(block: unknown): string {
  if (typeof block === "string") {
    return block;
  }

  if (!isRecord(block)) {
    return stringifyContent(block);
  }

  if (typeof block.text === "string") {
    return block.text;
  }

  if (typeof block.content === "string") {
    return block.content;
  }

  return JSON.stringify(block);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
