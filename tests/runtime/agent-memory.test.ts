import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  compareProjectContextIndex,
  getProjectAgentMemoryPath,
  loadProjectAgentMemory,
  readAgentMemories,
  readProjectContextIndex,
  saveAgentMemory,
  saveProjectContextIndex,
} from "../../src/runtime/agent-memory.js";

const execFileAsync = promisify(execFile);

async function createTempCwd() {
  return mkdtemp(join(tmpdir(), "gitx-agent-memory-"));
}

test("project agent memory persists durable summaries under git root .gitx", async () => {
  const root = await createTempCwd();
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
  const gitRoot = await realpath(root);
  const nested = join(root, "packages", "cli");
  await mkdir(nested, { recursive: true });

  const saved = await saveAgentMemory(
    nested,
    {
      category: "team_policy",
      content: "团队提交信息使用 conventional commits。",
      sourceAgent: "lark",
      sourceTask: "authorize",
      tags: ["commit", "policy"],
    },
    new Date("2026-05-01T10:00:00.000Z"),
  );

  assert.equal(await getProjectAgentMemoryPath(nested), join(gitRoot, ".gitx", "memory.json"));
  assert.equal(saved.saved, true);
  assert.deepEqual(
    (await readAgentMemories(root, { category: "team_policy" })).map((memory) => ({
      category: memory.category,
      content: memory.content,
      sourceAgent: memory.sourceAgent,
      sourceTask: memory.sourceTask,
      tags: memory.tags,
    })),
    [
      {
        category: "team_policy",
        content: "团队提交信息使用 conventional commits。",
        sourceAgent: "lark",
        sourceTask: "authorize",
        tags: ["commit", "policy"],
      },
    ],
  );
  assert.equal(
    JSON.parse(await readFile(join(gitRoot, ".gitx", "memory.json"), "utf8")).schemaVersion,
    1,
  );
});

test("project agent memory treats empty malformed and incompatible files as empty", async () => {
  const cwd = await createTempCwd();
  await mkdir(join(cwd, ".gitx"), { recursive: true });
  await writeFile(join(cwd, ".gitx", "memory.json"), "", "utf8");

  assert.deepEqual(await loadProjectAgentMemory(cwd), {
    memories: [],
    projectContextIndex: null,
  });

  await writeFile(join(cwd, ".gitx", "memory.json"), "{", "utf8");
  assert.deepEqual(await loadProjectAgentMemory(cwd), {
    memories: [],
    projectContextIndex: null,
  });

  await writeFile(
    join(cwd, ".gitx", "memory.json"),
    JSON.stringify({ schemaVersion: 999, memories: [{ content: "old" }] }),
    "utf8",
  );
  assert.deepEqual(await loadProjectAgentMemory(cwd), {
    memories: [],
    projectContextIndex: null,
  });
});

test("saveAgentMemory upserts meaningful entries and readAgentMemories filters them", async () => {
  const cwd = await createTempCwd();
  const first = await saveAgentMemory(
    cwd,
    {
      category: "team_policy",
      content: "团队提交信息使用 conventional commits。",
      sourceAgent: "lark",
      sourceTask: "authorize",
      tags: ["commit", "policy"],
    },
    new Date("2026-05-01T10:00:00.000Z"),
  );
  const second = await saveAgentMemory(
    cwd,
    {
      category: "team_policy",
      content: " 团队提交信息使用 conventional commits。 ",
      sourceAgent: "command",
      sourceTask: "commitMessage",
      tags: ["git"],
    },
    new Date("2026-05-01T10:05:00.000Z"),
  );
  const empty = await saveAgentMemory(cwd, {
    category: "team_policy",
    content: "   ",
    sourceAgent: "command",
    tags: [],
  });

  assert.equal(first.saved, true);
  assert.equal(second.saved, true);
  assert.equal(second.action, "updated");
  assert.equal(empty.saved, false);
  assert.deepEqual(await readAgentMemories(cwd, { category: "team_policy" }), [
    {
      id: first.memory?.id,
      category: "team_policy",
      content: "团队提交信息使用 conventional commits。",
      sourceAgent: "command",
      sourceTask: "commitMessage",
      tags: ["commit", "git", "policy"],
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-01T10:05:00.000Z",
    },
  ]);
  assert.equal(
    (await readAgentMemories(cwd, { query: "conventional", tags: ["git"], limit: 1 })).length,
    1,
  );
  assert.deepEqual(await readAgentMemories(cwd, { query: "missing" }), []);
});

test("project context index can be saved read and compared by directory fingerprint", async () => {
  const cwd = await createTempCwd();
  const index = {
    project: "feishuAI",
    knowledgeBase: {
      title: "FlowDesk 知识库",
      spaceId: "spc_1",
      nodeToken: "wikcn_root",
    },
    documents: [
      {
        title: "提交规范",
        path: "工程/提交规范",
        obj_type: "docx",
        obj_token: "docx_1",
        node_token: "wikcn_doc_1",
        space_id: "spc_1",
      },
    ],
    outlines: [
      {
        title: "提交规范",
        headings: ["Commit message", "分支策略"],
      },
    ],
    nonDocResources: [],
    coverage: {
      indexedCount: 1,
      skippedCount: 0,
      issues: [],
    },
    retrievalHints: ["提交规范", "commit message"],
  };

  const saved = await saveProjectContextIndex(
    cwd,
    index,
    new Date("2026-05-01T11:00:00.000Z"),
  );
  const loaded = await readProjectContextIndex(cwd);

  assert.equal(saved.fingerprint.length > 12, true);
  assert.deepEqual(loaded, {
    ...index,
    fingerprint: saved.fingerprint,
    updatedAt: "2026-05-01T11:00:00.000Z",
  });
  assert.deepEqual(await compareProjectContextIndex(cwd, index.documents), {
    status: "unchanged",
    localFingerprint: saved.fingerprint,
    onlineFingerprint: saved.fingerprint,
  });
  const changed = await compareProjectContextIndex(cwd, [
    ...index.documents,
    {
      title: "排障手册",
      path: "工程/排障手册",
      obj_type: "docx",
      obj_token: "docx_2",
      node_token: "wikcn_doc_2",
      space_id: "spc_1",
    },
  ]);
  assert.equal(changed.status, "changed");
  assert.notEqual(changed.onlineFingerprint, saved.fingerprint);
});
