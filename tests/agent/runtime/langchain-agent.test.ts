import assert from "node:assert/strict";
import test from "node:test";

import { tool } from "@langchain/core/tools";
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
  assert.deepEqual(
    extractLangChainAgentMetadata(
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
    ),
    {
      durationMs: 1234,
      tokenUsage: {
        totalTokens: 20,
      },
    },
  );
});

test("extractLangChainAgentMetadata supports OpenAI tokenUsage metadata", () => {
  assert.deepEqual(
    extractLangChainAgentMetadata(
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
    ),
    {
      durationMs: 42,
      tokenUsage: {
        totalTokens: 15,
      },
    },
  );
});

test("extractLangChainAgentMetadata sums token usage across agent turns", () => {
  assert.deepEqual(
    extractLangChainAgentMetadata(
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
    ),
    {
      durationMs: 2000,
      tokenUsage: {
        totalTokens: 230,
      },
    },
  );
});
