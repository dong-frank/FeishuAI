import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import {
  type AgentMemoryEntry,
  compareProjectContextIndex,
  readAgentMemories,
  readProjectContextIndex,
  saveAgentMemory,
  saveProjectContextIndex,
} from "../runtime/agent-memory.js";

import {
  withTuiDisplay,
} from "./runtime/langchain-agent.js";

const MEMORY_CATEGORY_SCHEMA = z
  .string()
  .min(1)
  .describe(
    "Memory category, for example project_context, team_policy, troubleshooting, workflow_preference, command_pattern, lark_resource, or other.",
  );

const PROJECT_CONTEXT_NODE_SCHEMA = z
  .object({
    title: z.string().optional(),
    path: z.string().optional(),
    obj_type: z.string().optional(),
    obj_token: z.string().optional(),
    node_token: z.string().optional(),
    space_id: z.string().optional(),
  })
  .catchall(z.unknown());

const JSON_OBJECT_SCHEMA = z.record(z.string(), z.unknown());

export type CompactAgentMemory = {
  category: string;
  content: string;
  sourceAgent: string;
  sourceTask?: string;
  tags?: string[];
  updatedAt: string;
};

export type AgentMemoryHint = {
  memories: CompactAgentMemory[];
};

const AGENT_MEMORY_HINT_LIMIT = 5;

export async function buildAgentMemoryHint(
  cwd: string,
  limit = AGENT_MEMORY_HINT_LIMIT,
): Promise<AgentMemoryHint | undefined> {
  try {
    const memories = await readAgentMemories(cwd, { limit });
    const compactMemories = memories.map(compactAgentMemory);
    return compactMemories.length > 0 ? { memories: compactMemories } : undefined;
  } catch {
    return undefined;
  }
}

function compactAgentMemory(memory: AgentMemoryEntry): CompactAgentMemory {
  return {
    category: memory.category,
    content: memory.content,
    sourceAgent: memory.sourceAgent,
    ...(memory.sourceTask ? { sourceTask: memory.sourceTask } : {}),
    ...(memory.tags.length > 0 ? { tags: memory.tags } : {}),
    updatedAt: memory.updatedAt,
  };
}

export function createSaveMemoryTool(): StructuredToolInterface {
  return withTuiDisplay(
  tool(
    async (input) => JSON.stringify(await saveAgentMemory(input.cwd, input)),
    {
      name: "save_memory",
      description:
        "Save durable project-level value memory to .gitx/memory.json. Save only concise summaries such as team policy, workflow preference, troubleshooting lessons, or stable project context. Do not save full stdout/stderr, full git status, full Lark CLI JSON, secrets, or full document text.",
      schema: z
        .object({
          cwd: z.string().describe("Current project working directory from context.cwd."),
          category: MEMORY_CATEGORY_SCHEMA.describe("Memory category."),
          content: z.string().describe("Concise durable summary worth keeping."),
          sourceAgent: z.enum(["command", "lark"]).describe("Agent writing this memory."),
          sourceTask: z.string().optional().describe("Task/action that produced this memory."),
          tags: z.array(z.string()).default([]).describe("Short lookup tags."),
        })
        .strict(),
    },
  ),
    "保存记忆"
  );
}

export function createReadMemoryTool(): StructuredToolInterface {
  return withTuiDisplay(
    tool(
    async ({ cwd, category, query, tags = [], limit = 10 }) =>
      JSON.stringify({
        memories: await readAgentMemories(cwd, {
          ...(category ? { category } : {}),
          ...(query ? { query } : {}),
          tags,
          limit,
        }),
      }),
    {
      name: "read_memory",
      description:
        "Read durable project-level value memories from .gitx/memory.json by category, query, tags, and limit. Memories are hints only; realtime command facts must come from current context/result/tools.",
      schema: z
        .object({
          cwd: z.string().describe("Current project working directory from context.cwd."),
          category: MEMORY_CATEGORY_SCHEMA.optional().describe("Optional category filter."),
          query: z.string().optional().describe("Optional case-insensitive text query."),
          tags: z.array(z.string()).default([]).describe("Tags that must all be present."),
          limit: z.number().int().positive().max(50).default(10),
        })
        .strict(),
    },
  ),
    "读取记忆"
  );
}

export function createReadProjectContextIndexTool(): StructuredToolInterface {
  return withTuiDisplay(
    tool(
    async ({ cwd }) =>
      JSON.stringify({
        projectContextIndex: await readProjectContextIndex(cwd),
      }),
    {
      name: "read_project_context_index",
      description:
        "Read the local project knowledge-base warmup index from .gitx/memory.json, including documents, outlines, retrieval hints, and fingerprint.",
      schema: z
        .object({
          cwd: z.string().describe("Current project working directory from context.cwd."),
        })
        .strict(),
    },
  ),
  "读取本地预热知识库");
}

export function createSaveProjectContextIndexTool(): StructuredToolInterface {
  return tool(
    async (input) =>
      JSON.stringify(
        await saveProjectContextIndex(input.cwd, {
          ...(input.project ? { project: input.project } : {}),
          ...(input.knowledgeBase ? { knowledgeBase: input.knowledgeBase } : {}),
          documents: input.documents,
          ...(input.outlines ? { outlines: input.outlines } : {}),
          ...(input.nonDocResources ? { nonDocResources: input.nonDocResources } : {}),
          ...(input.coverage ? { coverage: input.coverage } : {}),
          ...(input.retrievalHints ? { retrievalHints: input.retrievalHints } : {}),
        }),
      ),
    {
      name: "save_project_context_index",
      description:
        "Save the structured local project knowledge-base warmup index into .gitx/memory.json. Store directory nodes, light outlines, summaries, coverage, retrieval hints, and fingerprint only; never store full document text or full Lark CLI output.",
      schema: z
        .object({
          cwd: z.string().describe("Current project working directory from context.cwd."),
          project: z.string().optional(),
          knowledgeBase: JSON_OBJECT_SCHEMA.optional(),
          documents: z.array(PROJECT_CONTEXT_NODE_SCHEMA).default([]),
          outlines: z.array(z.unknown()).default([]),
          nonDocResources: z.array(PROJECT_CONTEXT_NODE_SCHEMA).default([]),
          coverage: JSON_OBJECT_SCHEMA.optional(),
          retrievalHints: z.array(z.string()).default([]),
        })
        .strict(),
    },
  );
}

export function createCompareProjectContextIndexTool(): StructuredToolInterface {
  return tool(
    async ({ cwd, onlineDirectory }) =>
      JSON.stringify(await compareProjectContextIndex(cwd, onlineDirectory)),
    {
      name: "compare_project_context_index",
      description:
        "Compare the local project context index fingerprint with an online read-only directory summary. Fingerprint v1 uses only stable node fields: title/path/obj_type/obj_token/node_token/space_id.",
      schema: z
        .object({
          cwd: z.string().describe("Current project working directory from context.cwd."),
          onlineDirectory: z
            .array(PROJECT_CONTEXT_NODE_SCHEMA)
            .describe("Current online directory nodes from read-only Lark traversal."),
        })
        .strict(),
    },
  );
}

export function createAgentMemoryTools(): StructuredToolInterface[] {
  return [createSaveMemoryTool(), createReadMemoryTool()];
}

export function createProjectContextIndexTools(): StructuredToolInterface[] {
  return [
    createReadProjectContextIndexTool(),
    createSaveProjectContextIndexTool(),
    createCompareProjectContextIndexTool(),
  ];
}
