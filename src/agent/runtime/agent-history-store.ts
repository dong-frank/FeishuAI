import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  LangChainHistoryMessage,
  LangChainHistoryStore,
} from "./langchain-agent.js";

type AgentHistoryName = "linus" | "friday";

type AgentHistoryFile = {
  schemaVersion: 1;
  messages: LangChainHistoryMessage[];
};

const AGENT_HISTORY_SCHEMA_VERSION = 1;
const GITX_STATE_DIR = ".gitx";

export function createAgentHistoryStore(
  name: AgentHistoryName,
): LangChainHistoryStore {
  return {
    async load(input) {
      const cwd = extractAgentInvocationCwd(input);
      if (!cwd) {
        return [];
      }

      try {
        const parsed = JSON.parse(
          await readFile(getAgentHistoryPath(cwd, name), "utf8"),
        ) as Partial<AgentHistoryFile>;
        if (
          parsed.schemaVersion !== AGENT_HISTORY_SCHEMA_VERSION ||
          !Array.isArray(parsed.messages)
        ) {
          return [];
        }

        return parsed.messages.filter(isHistoryMessage);
      } catch (error) {
        if (error instanceof SyntaxError || isRecoverableFileSystemError(error)) {
          return [];
        }

        throw error;
      }
    },
    async save(input, messages) {
      const cwd = extractAgentInvocationCwd(input);
      if (!cwd) {
        return;
      }

      try {
        const historyPath = getAgentHistoryPath(cwd, name);
        await mkdir(join(cwd, GITX_STATE_DIR), { recursive: true });
        const payload: AgentHistoryFile = {
          schemaVersion: AGENT_HISTORY_SCHEMA_VERSION,
          messages,
        };
        const tempPath = `${historyPath}.tmp`;
        await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        await rename(tempPath, historyPath);
      } catch (error) {
        if (isRecoverableFileSystemError(error)) {
          return;
        }

        throw error;
      }
    },
  };
}

export function getAgentHistoryPath(cwd: string, name: AgentHistoryName) {
  return join(cwd, GITX_STATE_DIR, `${name}-history.json`);
}

export function extractAgentInvocationCwd(input: string) {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "context" in parsed &&
      parsed.context &&
      typeof parsed.context === "object" &&
      "cwd" in parsed.context &&
      typeof parsed.context.cwd === "string"
    ) {
      return parsed.context.cwd;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isHistoryMessage(value: unknown): value is LangChainHistoryMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "role" in value &&
    (value.role === "user" || value.role === "assistant") &&
    "content" in value &&
    typeof value.content === "string"
  );
}

function isRecoverableFileSystemError(error: unknown) {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }

  return ["EACCES", "ENOENT", "ENOTDIR", "EPERM", "EROFS"].includes(
    String(error.code),
  );
}
