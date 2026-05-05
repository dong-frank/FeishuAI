import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createAgentHistoryStore,
  extractAgentInvocationCwd,
  getAgentHistoryPath,
} from "../../../src/agent/runtime/agent-history-store.js";

async function createTempCwd() {
  return mkdtemp(join(tmpdir(), "gitx-agent-history-"));
}

test("extractAgentInvocationCwd reads the cwd from agent invocation JSON", () => {
  assert.equal(
    extractAgentInvocationCwd(JSON.stringify({ context: { cwd: "/repo" } })),
    "/repo",
  );
  assert.equal(extractAgentInvocationCwd("plain text"), undefined);
});

test("agent history store persists compact history under .gitx", async () => {
  const cwd = await createTempCwd();
  const input = JSON.stringify({ context: { cwd } });
  const store = createAgentHistoryStore("linus");
  const messages = [
    { role: "user" as const, content: "saved user" },
    { role: "assistant" as const, content: "saved assistant" },
  ];

  await store.save(input, messages);

  assert.equal(getAgentHistoryPath(cwd, "linus"), join(cwd, ".gitx", "linus-history.json"));
  assert.deepEqual(await store.load(input), messages);
  assert.deepEqual(JSON.parse(await readFile(getAgentHistoryPath(cwd, "linus"), "utf8")), {
    schemaVersion: 1,
    messages,
  });
});

test("agent history store returns empty history for missing or malformed files", async () => {
  const cwd = await createTempCwd();
  const input = JSON.stringify({ context: { cwd } });
  const store = createAgentHistoryStore("friday");

  assert.deepEqual(await store.load(input), []);

  await writeFile(getAgentHistoryPath(cwd, "friday"), "{", "utf8").catch(async () => {
    await store.save(input, []);
    await writeFile(getAgentHistoryPath(cwd, "friday"), "{", "utf8");
  });

  assert.deepEqual(await store.load(input), []);
});

test("agent history store ignores inaccessible cwd without interrupting agents", async () => {
  const cwd = join(await createTempCwd(), "not-a-directory");
  await writeFile(cwd, "", "utf8");
  const input = JSON.stringify({ context: { cwd } });
  const store = createAgentHistoryStore("linus");

  await assert.doesNotReject(() =>
    store.save(input, [{ role: "user", content: "not persisted" }]),
  );
  assert.deepEqual(await store.load(input), []);
});
