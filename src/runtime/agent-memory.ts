import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { GITX_STATE_DIR } from "./git-command-stats.js";
import { resolveProjectStateRoot } from "./project-root.js";

export type AgentMemoryEntry = {
  id: string;
  category: string;
  content: string;
  sourceAgent: string;
  sourceTask?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectContextIndexNode = {
  title?: string | undefined;
  path?: string | undefined;
  obj_type?: string | undefined;
  obj_token?: string | undefined;
  node_token?: string | undefined;
  space_id?: string | undefined;
  [key: string]: unknown;
};

export type ProjectContextIndex = {
  project?: string;
  knowledgeBase?: Record<string, unknown>;
  documents: ProjectContextIndexNode[];
  outlines?: unknown[];
  nonDocResources?: ProjectContextIndexNode[];
  coverage?: Record<string, unknown>;
  retrievalHints?: string[];
  fingerprint: string;
  updatedAt: string;
};

export type ProjectAgentMemory = {
  memories: AgentMemoryEntry[];
  projectContextIndex: ProjectContextIndex | null;
};

export type SaveAgentMemoryInput = {
  category: string;
  content: string;
  sourceAgent: string;
  sourceTask?: string | undefined;
  tags?: string[] | undefined;
};

export type ReadAgentMemoriesInput = {
  category?: string | undefined;
  query?: string | undefined;
  tags?: string[] | undefined;
  limit?: number | undefined;
};

type ProjectAgentMemoryFile = {
  schemaVersion: 1;
  memories: AgentMemoryEntry[];
  projectContextIndex: ProjectContextIndex | null;
};

export const AGENT_MEMORY_SCHEMA_VERSION = 1;
export const AGENT_MEMORY_FILE = "memory.json";

export async function getProjectAgentMemoryPath(cwd: string) {
  const root = await resolveProjectStateRoot(cwd);
  return join(root, GITX_STATE_DIR, AGENT_MEMORY_FILE);
}

export async function loadProjectAgentMemory(cwd: string): Promise<ProjectAgentMemory> {
  try {
    const content = await readFile(await getProjectAgentMemoryPath(cwd), "utf8");
    if (!content.trim()) {
      return createEmptyProjectAgentMemory();
    }

    const parsed = JSON.parse(content) as Partial<ProjectAgentMemoryFile>;
    if (parsed.schemaVersion !== AGENT_MEMORY_SCHEMA_VERSION) {
      return createEmptyProjectAgentMemory();
    }

    return {
      memories: normalizeAgentMemoryEntries(parsed.memories),
      projectContextIndex: normalizeProjectContextIndex(parsed.projectContextIndex),
    };
  } catch (error) {
    if (error instanceof SyntaxError || isMissingFileError(error)) {
      return createEmptyProjectAgentMemory();
    }

    throw error;
  }
}

export async function saveProjectAgentMemory(
  cwd: string,
  memory: ProjectAgentMemory,
) {
  const memoryPath = await getProjectAgentMemoryPath(cwd);
  await mkdir(dirname(memoryPath), { recursive: true });
  const tempPath = `${memoryPath}.tmp`;
  const file: ProjectAgentMemoryFile = {
    schemaVersion: AGENT_MEMORY_SCHEMA_VERSION,
    memories: normalizeAgentMemoryEntries(memory.memories),
    projectContextIndex: normalizeProjectContextIndex(memory.projectContextIndex),
  };
  await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(tempPath, memoryPath);
}

export async function saveAgentMemory(
  cwd: string,
  input: SaveAgentMemoryInput,
  now = new Date(),
) {
  const content = input.content.trim();
  if (!content) {
    return {
      saved: false,
      reason: "empty_content",
    };
  }

  const category = input.category.trim() || "other";
  const id = createMemoryId(category, content);
  const state = await loadProjectAgentMemory(cwd);
  const existing = state.memories.find((memory) => memory.id === id);
  const updatedAt = now.toISOString();

  if (existing) {
    const updated = {
      ...existing,
      content,
      sourceAgent: input.sourceAgent,
      ...(input.sourceTask ? { sourceTask: input.sourceTask } : {}),
      tags: normalizeTags([...(existing.tags ?? []), ...(input.tags ?? [])]),
      updatedAt,
    };
    state.memories = state.memories.map((memory) =>
      memory.id === id ? updated : memory,
    );
    await saveProjectAgentMemory(cwd, state);
    return {
      saved: true,
      action: "updated",
      memory: updated,
    };
  }

  const memory = {
    id,
    category,
    content,
    sourceAgent: input.sourceAgent,
    ...(input.sourceTask ? { sourceTask: input.sourceTask } : {}),
    tags: normalizeTags(input.tags ?? []),
    createdAt: updatedAt,
    updatedAt,
  };
  state.memories = [...state.memories, memory];
  await saveProjectAgentMemory(cwd, state);
  return {
    saved: true,
    action: "created",
    memory,
  };
}

export async function readAgentMemories(
  cwd: string,
  input: ReadAgentMemoriesInput = {},
) {
  const state = await loadProjectAgentMemory(cwd);
  const query = input.query?.trim().toLowerCase() ?? "";
  const tags = normalizeTags(input.tags ?? []);
  const limit = Math.max(0, input.limit ?? 10);

  return state.memories
    .filter((memory) => !input.category || memory.category === input.category)
    .filter((memory) => !query || memoryMatchesQuery(memory, query))
    .filter((memory) => tags.every((tag) => memory.tags.includes(tag)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
}

export async function saveProjectContextIndex(
  cwd: string,
  input: Omit<ProjectContextIndex, "fingerprint" | "updatedAt"> &
    Partial<Pick<ProjectContextIndex, "fingerprint" | "updatedAt">>,
  now = new Date(),
) {
  const state = await loadProjectAgentMemory(cwd);
  const nodes = [
    ...(Array.isArray(input.documents) ? input.documents : []),
    ...(Array.isArray(input.nonDocResources) ? input.nonDocResources : []),
  ];
  const projectContextIndex = {
    ...input,
    documents: normalizeProjectContextNodes(input.documents),
    ...(input.outlines ? { outlines: input.outlines } : {}),
    ...(input.nonDocResources
      ? { nonDocResources: normalizeProjectContextNodes(input.nonDocResources) }
      : {}),
    fingerprint: computeProjectContextFingerprint(nodes),
    updatedAt: now.toISOString(),
  };
  state.projectContextIndex = projectContextIndex;
  await saveProjectAgentMemory(cwd, state);
  return {
    saved: true,
    fingerprint: projectContextIndex.fingerprint,
    projectContextIndex,
  };
}

export async function readProjectContextIndex(cwd: string) {
  return (await loadProjectAgentMemory(cwd)).projectContextIndex;
}

export async function compareProjectContextIndex(
  cwd: string,
  onlineDirectory: ProjectContextIndexNode[],
) {
  const local = await readProjectContextIndex(cwd);
  const onlineFingerprint = computeProjectContextFingerprint(onlineDirectory);
  if (!local) {
    return {
      status: "missing",
      localFingerprint: null,
      onlineFingerprint,
    };
  }

  return {
    status: local.fingerprint === onlineFingerprint ? "unchanged" : "changed",
    localFingerprint: local.fingerprint,
    onlineFingerprint,
  };
}

export function computeProjectContextFingerprint(nodes: ProjectContextIndexNode[]) {
  const normalized = normalizeProjectContextNodes(nodes)
    .map((node) => ({
      title: node.title ?? "",
      path: node.path ?? "",
      obj_type: node.obj_type ?? "",
      obj_token: node.obj_token ?? "",
      node_token: node.node_token ?? "",
      space_id: node.space_id ?? "",
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );

  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

function normalizeAgentMemoryEntries(memories: unknown): AgentMemoryEntry[] {
  if (!Array.isArray(memories)) {
    return [];
  }

  return memories.flatMap((memory) => {
    if (
      typeof memory === "object" &&
      memory !== null &&
      "id" in memory &&
      typeof memory.id === "string" &&
      "category" in memory &&
      typeof memory.category === "string" &&
      "content" in memory &&
      typeof memory.content === "string" &&
      memory.content.trim() &&
      "sourceAgent" in memory &&
      typeof memory.sourceAgent === "string" &&
      "createdAt" in memory &&
      typeof memory.createdAt === "string" &&
      "updatedAt" in memory &&
      typeof memory.updatedAt === "string"
    ) {
      return [
        {
          id: memory.id,
          category: memory.category,
          content: memory.content,
          sourceAgent: memory.sourceAgent,
          ...("sourceTask" in memory && typeof memory.sourceTask === "string"
            ? { sourceTask: memory.sourceTask }
            : {}),
          tags: normalizeTags("tags" in memory && Array.isArray(memory.tags) ? memory.tags : []),
          createdAt: memory.createdAt,
          updatedAt: memory.updatedAt,
        },
      ];
    }

    return [];
  });
}

function normalizeProjectContextIndex(value: unknown): ProjectContextIndex | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const input = value as Record<string, unknown>;
  if (
    !Array.isArray(input.documents) ||
    typeof input.fingerprint !== "string" ||
    typeof input.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    ...(typeof input.project === "string" ? { project: input.project } : {}),
    ...(isRecord(input.knowledgeBase) ? { knowledgeBase: input.knowledgeBase } : {}),
    documents: normalizeProjectContextNodes(input.documents),
    ...(Array.isArray(input.outlines) ? { outlines: input.outlines } : {}),
    ...(Array.isArray(input.nonDocResources)
      ? { nonDocResources: normalizeProjectContextNodes(input.nonDocResources) }
      : {}),
    ...(isRecord(input.coverage) ? { coverage: input.coverage } : {}),
    ...(Array.isArray(input.retrievalHints)
      ? { retrievalHints: input.retrievalHints.filter(isString) }
      : {}),
    fingerprint: input.fingerprint,
    updatedAt: input.updatedAt,
  };
}

function normalizeProjectContextNodes(nodes: unknown): ProjectContextIndexNode[] {
  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes.filter(isRecord).map((node) => ({ ...node }));
}

function memoryMatchesQuery(memory: AgentMemoryEntry, query: string) {
  return [
    memory.category,
    memory.content,
    memory.sourceAgent,
    memory.sourceTask ?? "",
    ...memory.tags,
  ].some((value) => value.toLowerCase().includes(query));
}

function createMemoryId(category: string, content: string) {
  return createHash("sha256")
    .update(`${category}\n${content}`)
    .digest("hex")
    .slice(0, 24);
}

function normalizeTags(tags: unknown[]) {
  return [...new Set(tags.filter(isString).map((tag) => tag.trim()).filter(Boolean))]
    .sort();
}

function createEmptyProjectAgentMemory(): ProjectAgentMemory {
  return {
    memories: [],
    projectContextIndex: null,
  };
}

function isMissingFileError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
