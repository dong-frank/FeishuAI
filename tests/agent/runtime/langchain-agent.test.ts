import assert from "node:assert/strict";
import test from "node:test";

import { tool } from "@langchain/core/tools";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { ChatOpenAI } from "@langchain/openai";
import { FakeToolCallingModel } from "langchain";
import { z } from "zod";

import {
  createLangChainAgent,
  createLangChainChatModel,
  extractLangChainAgentMetadata,
  getLangChainAgentOutputText,
  resolveLangChainModelName,
  shouldTraceLangChainAgent,
} from "../../../src/agent/runtime/langchain-agent.js";

class FeedbackAwareFakeListChatModel extends FakeListChatModel {
  seenMessages: string[][] = [];

  bindTools() {
    return this;
  }

  async _generate(messages: any[], options?: any) {
    this.seenMessages.push(messages.map((message) => String(message.content ?? "")));
    return super._generate(messages, options);
  }
}

test("createLangChainChatModel reads model configuration", () => {
  const model = createLangChainChatModel({
    apiKey: "test-key",
    baseURL: "https://example.com/api/v3",
    model: "test-model",
  });

  assert.equal(model.model, "test-model");
});

test("resolveLangChainModelName reads role-specific model environment variables", () => {
  const env = {
    MODEL: "default-model",
    COMMAND_MODEL: "structured-command-model",
    LARK_MODEL: "lark-model",
  };

  assert.equal(resolveLangChainModelName("default", env), "default-model");
  assert.equal(resolveLangChainModelName("command", env), "structured-command-model");
  assert.equal(resolveLangChainModelName("lark", env), "lark-model");
});

test("resolveLangChainModelName falls back to MODEL for role-specific agents", () => {
  const env = {
    MODEL: "default-model",
  };

  assert.equal(resolveLangChainModelName("command", env), "default-model");
  assert.equal(resolveLangChainModelName("lark", env), "default-model");
});

test("createLangChainChatModel disables thinking by default", () => {
  const model = createLangChainChatModel({
    apiKey: "test-key",
    model: "test-model",
  });

  assert.deepEqual(model.modelKwargs.thinking, { type: "disabled" });
});

test("createLangChainChatModel can override thinking kwargs", () => {
  const model = createLangChainChatModel({
    apiKey: "test-key",
    model: "test-model",
    disableThinking: false,
    modelKwargs: {
      thinking: { type: "enabled" },
    },
  });

  assert.deepEqual(model.modelKwargs.thinking, { type: "enabled" });
});

test("shouldTraceLangChainAgent disables tracing in test environment", () => {
  assert.equal(shouldTraceLangChainAgent({ NODE_ENV: "test" }), false);
  assert.equal(shouldTraceLangChainAgent({ NODE_ENV: "development" }), true);
});

test("createLangChainAgent accepts a system prompt and tools", () => {
  const agent = createLangChainAgent({
    systemPrompt: "You are a test agent.",
    tools: [],
    model: createLangChainChatModel({
      apiKey: "test-key",
      baseURL: "https://example.com/api/v3",
      model: "test-model",
    }),
  });

  assert.equal(agent.systemPrompt, "You are a test agent.");
  assert.equal(agent.tools.length, 0);
});

test("createLangChainAgent executes tool calls through LangChain createAgent", async () => {
  let calledWith = "";
  const lookupTool = tool(
    async ({ query }) => {
      calledWith = query;
      return `manual for ${query}`;
    },
    {
      name: "lookup_manual",
      description: "Lookup a manual page.",
      schema: z.object({
        query: z.string(),
      }),
    },
  );
  const model = new FakeToolCallingModel({
    toolCalls: [
      [{ name: "lookup_manual", args: { query: "git push" }, id: "call-1" }],
      [],
    ],
  });
  const agent = createLangChainAgent({
    systemPrompt: "Use tools when helpful.",
    tools: [lookupTool],
    model: model as unknown as ChatOpenAI,
  });

  const output = await agent.invoke("Explain git push");

  assert.equal(calledWith, "git push");
  assert.match(output, /manual for git push/);
});

test("createLangChainAgent reports raw tool calls in metadata", async () => {
  const lookupTool = tool(
    async ({ query }) => `manual for ${query}`,
    {
      name: "lookup_manual",
      description: "Lookup a manual page.",
      schema: z.object({
        query: z.string(),
      }),
    },
  );
  const model = new FakeToolCallingModel({
    toolCalls: [
      [{ name: "lookup_manual", args: { query: "git push" }, id: "call-1" }],
      [],
    ],
  });
  const agent = createLangChainAgent({
    systemPrompt: "Use tools when helpful.",
    tools: [lookupTool],
    model: model as unknown as ChatOpenAI,
  });

  const output = await agent.invokeWithMetadata("Explain git push");

  assert.match(JSON.stringify(output.metadata.rawToolCalls), /lookup_manual/);
  assert.match(JSON.stringify(output.metadata.rawToolCalls), /git push/);
  assert.match(output.metadata.rawAgentResult ?? "", /lookup_manual/);
});

test("createLangChainAgent emits tool progress for successful tool calls", async () => {
  const events: unknown[] = [];
  const lookupTool = tool(
    async ({ query }) => `manual for ${query}`,
    {
      name: "lookup_manual",
      description: "Lookup a manual page.",
      schema: z.object({
        query: z.string(),
      }),
    },
  );
  const model = new FakeToolCallingModel({
    toolCalls: [
      [{ name: "lookup_manual", args: { query: "git push --force-with-lease" }, id: "call-1" }],
      [],
    ],
  });
  const agent = createLangChainAgent({
    systemPrompt: "Use tools when helpful.",
    tools: [lookupTool],
    model: model as unknown as ChatOpenAI,
    onToolProgress(event) {
      events.push(event);
    },
  });

  await agent.invoke("Explain git push");

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => ({
      toolName: (event as { toolName: string }).toolName,
      state: (event as { state: string }).state,
    })),
    [
      { toolName: "lookup_manual", state: "running" },
      { toolName: "lookup_manual", state: "success" },
    ],
  );
  assert.equal(
    (events[0] as { inputSummary?: string }).inputSummary,
    "query=git push --force-with-lease",
  );
  assert.doesNotMatch(String((events[0] as { inputSummary?: string }).inputSummary), /[{}[\]"']/);
  assert.equal(typeof (events[1] as { durationMs?: number }).durationMs, "number");
});

test("createLangChainAgent emits failed tool progress and rethrows tool errors", async () => {
  const events: unknown[] = [];
  const failingTool = tool(
    async () => {
      throw new Error("manual lookup exploded with a verbose internal detail");
    },
    {
      name: "lookup_manual",
      description: "Lookup a manual page.",
      schema: z.object({
        query: z.string(),
      }),
    },
  );
  const model = new FakeToolCallingModel({
    toolCalls: [
      [{ name: "lookup_manual", args: { query: "git push" }, id: "call-1" }],
      [],
    ],
  });
  const agent = createLangChainAgent({
    systemPrompt: "Use tools when helpful.",
    tools: [failingTool],
    model: model as unknown as ChatOpenAI,
    onToolProgress(event) {
      events.push(event);
    },
  });

  await assert.rejects(() => agent.invoke("Explain git push"), /manual lookup exploded/);

  assert.deepEqual(
    events.map((event) => ({
      toolName: (event as { toolName: string }).toolName,
      state: (event as { state: string }).state,
    })),
    [
      { toolName: "lookup_manual", state: "running" },
      { toolName: "lookup_manual", state: "failed" },
    ],
  );
  assert.match(String((events[1] as { error?: string }).error), /manual lookup exploded/);
  assert.equal(typeof (events[1] as { durationMs?: number }).durationMs, "number");
});

test("createLangChainAgent preserves message history when requested", async () => {
  const model = new FakeToolCallingModel();
  const agent = createLangChainAgent({
    systemPrompt: "Remember previous turns.",
    tools: [],
    model: model as unknown as ChatOpenAI,
    preserveHistory: true,
  });

  await agent.invoke("first command");
  const output = await agent.invoke("second command");

  assert.match(output, /first command/);
  assert.match(output, /second command/);
});

test("createLangChainAgent reports current preserved context size", async () => {
  const model = new FakeToolCallingModel();
  const agent = createLangChainAgent({
    systemPrompt: "Track context size.",
    tools: [],
    model: model as unknown as ChatOpenAI,
    preserveHistory: true,
  });

  const first = await agent.invokeWithMetadata("first command");
  const second = await agent.invokeWithMetadata("second command");

  assert.equal(first.metadata.contextUsage?.messageCount, 2);
  assert.equal(second.metadata.contextUsage?.messageCount, 4);
  assert.equal(typeof second.metadata.contextUsage?.characterCount, "number");
  assert.equal(typeof second.metadata.contextUsage?.estimatedTokens, "number");
  assert.ok(
    (second.metadata.contextUsage?.characterCount ?? 0) >
      (first.metadata.contextUsage?.characterCount ?? 0),
  );
});

test("createLangChainAgent can compact preserved history after each response", async () => {
  const agent = createLangChainAgent({
    systemPrompt: "Compact history.",
    tools: [],
    model: new FakeToolCallingModel() as unknown as ChatOpenAI,
    preserveHistory: true,
    compactHistoryEntry(input, output) {
      return {
        userContent: `compact user: ${input.includes("first") ? "first" : "second"}`,
        assistantContent: `compact assistant: ${output.includes("first") ? "first" : "second"}`,
      };
    },
  });

  const first = await agent.invokeWithMetadata("first command RAW_SECRET_TOOL_CONTEXT");
  const second = await agent.invokeWithMetadata("second command");

  assert.match(first.content, /RAW_SECRET_TOOL_CONTEXT/);
  assert.match(second.content, /compact user: first/);
  assert.match(second.content, /compact assistant: first/);
  assert.equal(second.metadata.contextUsage?.messageCount, 4);
  assert.ok((second.metadata.contextUsage?.characterCount ?? 0) < 120);
  assert.doesNotMatch(second.content, /RAW_SECRET_TOOL_CONTEXT/);
});

test("createLangChainAgent feeds back and retries when validated output is empty", async () => {
  const model = new FeedbackAwareFakeListChatModel({
    responses: ["", "regenerated answer"],
  });
  const agent = createLangChainAgent({
    systemPrompt: "Retry empty output.",
    tools: [],
    model: model as unknown as ChatOpenAI,
    preserveHistory: true,
  });

  const output = await agent.invokeWithMetadata("need answer");

  assert.equal(output.content, "regenerated answer");
  assert.equal(model.seenMessages.length, 2);
  assert.match(model.seenMessages[1].join("\n"), /上一次最终输出为空/);
  assert.equal(output.metadata.contextUsage?.messageCount, 2);
  assert.match(JSON.stringify(output.metadata.rawAgentResult), /regenerated answer/);
});

test("createLangChainAgent does not preserve message history by default", async () => {
  const model = new FakeToolCallingModel();
  const agent = createLangChainAgent({
    systemPrompt: "Do not remember previous turns.",
    tools: [],
    model: model as unknown as ChatOpenAI,
  });

  await agent.invoke("first command");
  const output = await agent.invoke("second command");

  assert.doesNotMatch(output, /first command/);
  assert.match(output, /second command/);
});

test("getLangChainAgentOutputText prefers structured responses", () => {
  assert.equal(
    getLangChainAgentOutputText({
      structuredResponse: {
        content: "检查状态",
        suggestedCommand: "git status --short",
      },
      messages: [{ content: "fallback text" }],
    }),
    '{"content":"检查状态","suggestedCommand":"git status --short"}',
  );
});

test("extractLangChainAgentMetadata reads duration and token usage", () => {
  const metadata = extractLangChainAgentMetadata(
    {
      messages: [
        {
          content: "hello",
          usage_metadata: {
            input_tokens: 12,
            output_tokens: 8,
            total_tokens: 20,
          },
        },
      ],
    },
    1234,
  );

  assert.equal(metadata.durationMs, 1234);
  assert.deepEqual(metadata.tokenUsage, { totalTokens: 20 });
  assert.match(metadata.rawAgentResult ?? "", /hello/);
});

test("extractLangChainAgentMetadata supports OpenAI tokenUsage metadata", () => {
  const metadata = extractLangChainAgentMetadata(
    {
      messages: [
        {
          content: "hello",
          response_metadata: {
            tokenUsage: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
            },
          },
        },
      ],
    },
    42,
  );

  assert.equal(metadata.durationMs, 42);
  assert.deepEqual(metadata.tokenUsage, { totalTokens: 15 });
  assert.match(metadata.rawAgentResult ?? "", /tokenUsage/);
});

test("extractLangChainAgentMetadata sums token usage across agent turns", () => {
  const metadata = extractLangChainAgentMetadata(
    {
      messages: [
        {
          content: "tool call",
          usage_metadata: {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
          },
        },
        {
          content: "tool result",
        },
        {
          content: "final",
          usage_metadata: {
            input_tokens: 80,
            output_tokens: 30,
            total_tokens: 110,
          },
        },
      ],
    },
    2000,
  );

  assert.equal(metadata.durationMs, 2000);
  assert.deepEqual(metadata.tokenUsage, { totalTokens: 230 });
  assert.match(metadata.rawAgentResult ?? "", /tool call/);
});
