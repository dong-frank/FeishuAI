import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, type ResponseFormat } from "langchain";
import { traceable } from "langsmith/traceable";

export type LangChainChatModelConfig = {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  disableThinking?: boolean;
  modelKwargs?: Record<string, unknown>;
};

export type LangChainAgentOptions = {
  systemPrompt: string;
  tools?: StructuredToolInterface[];
  model?: ChatOpenAI;
  name?: string;
  responseFormat?: ResponseFormat | undefined;
};

export type LangChainAgent = {
  systemPrompt: string;
  tools: StructuredToolInterface[];
  responseFormat?: ResponseFormat | undefined;
  invoke: (input: string) => Promise<string>;
};

export function createLangChainChatModel(config: LangChainChatModelConfig = {}) {
  const disableThinking = config.disableThinking ?? true;

  return new ChatOpenAI({
    apiKey: config.apiKey ?? process.env.API_KEY ?? "",
    model: config.model ?? process.env.MODEL ?? "",
    temperature: 0.7,
    modelKwargs: {
      ...(disableThinking ? { thinking: { type: "disabled" } } : {}),
      ...config.modelKwargs,
    },
    configuration: {
      baseURL:
        config.baseURL ?? "https://ark.cn-beijing.volces.com/api/v3",
    },
  });
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
  const invoke = async (input: string) => {
    const result = await agent.invoke({
      messages: [{ role: "user", content: input }],
    });

    return getLangChainAgentOutputText(result);
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
