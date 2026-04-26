import assert from "node:assert/strict";
import test from "node:test";

import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { FakeToolCallingModel } from "langchain";
import { z } from "zod";

import {
  createLangChainAgent,
  createLangChainChatModel,
  shouldTraceLangChainAgent,
} from "../../src/agent/langchain-agent.js";

test("createLangChainChatModel reads model configuration", () => {
  const model = createLangChainChatModel({
    apiKey: "test-key",
    baseURL: "https://example.com/api/v3",
    model: "test-model",
  });

  assert.equal(model.model, "test-model");
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
