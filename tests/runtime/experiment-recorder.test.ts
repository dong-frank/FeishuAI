import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createExperimentRecorder,
  findExperimentMarker,
} from "../../src/runtime/experiment-recorder.js";

async function createTempCwd() {
  return mkdtemp(join(tmpdir(), "git-helper-recorder-"));
}

test("findExperimentMarker returns undefined outside experiment workspaces", async () => {
  const cwd = await createTempCwd();

  assert.equal(await findExperimentMarker(cwd), undefined);
});

test("findExperimentMarker discovers experiment metadata from parent directories", async () => {
  const root = await createTempCwd();
  const child = join(root, "flowdesk", "nested");
  await mkdir(child, { recursive: true });
  await writeFile(
    join(root, ".git-helper-experiment.json"),
    JSON.stringify({
      experiment: "flowdesk",
      stage: "upstream",
      case_id: "FD-124-UPSTREAM",
      recommended_command: "git push",
      expected_phase: "afterFail",
      results_dir: join(root, "results"),
      created_at: "2026-04-29T00:00:00.000Z",
    }),
  );

  const marker = await findExperimentMarker(child);

  assert.equal(marker?.metadata.case_id, "FD-124-UPSTREAM");
  assert.equal(marker?.rootDir, root);
});

test("experiment recorder appends JSONL events with shared run metadata", async () => {
  const root = await createTempCwd();
  const resultsDir = join(root, "results");
  await writeFile(
    join(root, ".git-helper-experiment.json"),
    JSON.stringify({
      experiment: "flowdesk",
      stage: "upstream",
      case_id: "FD-124-UPSTREAM",
      recommended_command: "git push",
      expected_phase: "afterFail",
      results_dir: resultsDir,
      created_at: "2026-04-29T00:00:00.000Z",
    }),
  );

  const recorder = await createExperimentRecorder(root, {
    now: () => "2026-04-29T01:00:00.000Z",
    runId: "run-test",
  });

  assert.ok(recorder);
  await recorder.record({
    type: "command_submitted",
    cwd: root,
    command: "git push",
  });
  await recorder.record({
    type: "agent_completed",
    cwd: root,
    command: "git push",
    phase: "afterFail",
    agentKind: "command",
    content: "Use upstream push.",
    suggestedCommand: "git push -u origin feature/fd-124-priority-filter",
    metadata: {
      durationMs: 123,
      tokenUsage: {
        totalTokens: 456,
      },
    },
  });

  const lines = (await readFile(recorder.outputPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(lines.length, 2);
  assert.equal(lines[0].run_id, "run-test");
  assert.equal(lines[0].case_id, "FD-124-UPSTREAM");
  assert.equal(lines[0].type, "command_submitted");
  assert.equal(lines[1].type, "agent_completed");
  assert.equal(lines[1].suggestedCommand, "git push -u origin feature/fd-124-priority-filter");
  assert.equal(lines[1].metadata.tokenUsage.totalTokens, 456);
});
