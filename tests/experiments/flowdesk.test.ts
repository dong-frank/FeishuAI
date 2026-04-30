import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  exportFlowdeskCases,
  resetFlowdeskExperiment,
  scoreFlowdeskExperiment,
} from "../../experiments/flowdesk/scripts/reset.js";

const execFileAsync = promisify(execFile);

async function createTempWorkspace() {
  return mkdtemp(join(tmpdir(), "flowdesk-experiment-"));
}

async function git(args: string[], cwd: string) {
  return execFileAsync("git", args, { cwd });
}

test("reset commit-message stage creates a staged FlowDesk priority-filter diff", async () => {
  const workspaceRoot = await createTempWorkspace();

  const result = await resetFlowdeskExperiment({
    workspaceRoot,
    stage: "commit-message",
  });

  assert.equal(result.stage, "commit-message");
  assert.equal(result.caseId, "FD-124-COMMIT");
  assert.match(result.recommendedCommand, /git commit/);
  assert.match(result.expectedPhase, /beforeRun/);

  const branch = await git(["branch", "--show-current"], result.projectDir);
  assert.equal(branch.stdout.trim(), "feature/fd-124-priority-filter");

  const stagedDiff = await git(["diff", "--cached", "--", "flowdesk/tickets"], result.projectDir);
  assert.match(stagedDiff.stdout, /priority/);
  assert.match(stagedDiff.stdout, /filter_tickets/);
  assert.match(stagedDiff.stdout, /list_tickets/);
});

test("reset upstream stage creates a branch where plain git push fails with upstream guidance", async () => {
  const workspaceRoot = await createTempWorkspace();

  const result = await resetFlowdeskExperiment({
    workspaceRoot,
    stage: "upstream",
  });

  assert.equal(result.caseId, "FD-124-UPSTREAM");
  await assert.rejects(
    () => git(["push"], result.projectDir),
    /has no upstream branch/,
  );
});

test("reset writes experiment marker metadata for recorder discovery", async () => {
  const workspaceRoot = await createTempWorkspace();

  const result = await resetFlowdeskExperiment({
    workspaceRoot,
    stage: "upstream",
  });

  const marker = JSON.parse(
    await readFile(join(result.projectDir, ".git-helper-experiment.json"), "utf8"),
  );

  assert.equal(marker.experiment, "flowdesk");
  assert.equal(marker.stage, "upstream");
  assert.equal(marker.case_id, "FD-124-UPSTREAM");
  assert.equal(marker.recommended_command, "git push");
  assert.equal(marker.expected_phase, "afterFail");
  assert.equal(marker.results_dir, join(workspaceRoot, ".experiments", "results"));
  assert.match(marker.created_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("experiment marker is ignored by the demo repository status", async () => {
  const workspaceRoot = await createTempWorkspace();

  const result = await resetFlowdeskExperiment({
    workspaceRoot,
    stage: "commit-message",
  });

  const status = await git(["status", "--short"], result.projectDir);

  assert.doesNotMatch(status.stdout, /\.git-helper-experiment\.json/);
  assert.match(status.stdout, /^M  flowdesk\/tickets\/filters\.py/m);
  assert.match(status.stdout, /^M  flowdesk\/tickets\/service\.py/m);
  assert.match(status.stdout, /^M  tests\/test_ticket_filters\.py/m);
});

test("fresh reset includes lightweight project history and active sprint context", async () => {
  const workspaceRoot = await createTempWorkspace();

  const result = await resetFlowdeskExperiment({
    workspaceRoot,
    stage: "fresh",
  });

  const readProjectFile = (path: string) => readFile(join(result.projectDir, path), "utf8");
  const readLarkDoc = (path: string) => readFile(join(result.larkDocsDir, path), "utf8");

  assert.match(await readProjectFile("README.md"), /Sprint 10/);
  assert.match(await readProjectFile("docs/architecture-notes.md"), /ADR-003/);
  assert.match(await readProjectFile("flowdesk/tickets/audit.py"), /record_ticket_event/);
  assert.match(await readProjectFile("tests/test_ticket_service.py"), /test_list_tickets_returns_stable_id_order/);

  const board = await readLarkDoc("FlowDesk Sprint 12 需求看板.md");
  assert.match(board, /FD-118/);
  assert.match(board, /FD-121/);
  assert.match(board, /FD-124/);
  assert.match(board, /早上站会/);
  assert.match(board, /Scrum Master/);
  assert.match(board, /Product Owner/);
  assert.match(board, /CI\/CD/);
});

test("export and score produce reusable evaluation artifacts", async () => {
  const workspaceRoot = await createTempWorkspace();
  await resetFlowdeskExperiment({ workspaceRoot, stage: "fresh" });
  const runPath = join(workspaceRoot, ".experiments", "results", "runs", "demo-run.jsonl");
  await writeFile(runPath, "{\"type\":\"command_submitted\"}\n");

  const exportResult = await exportFlowdeskCases({ workspaceRoot });
  const jsonl = await readFile(exportResult.outputPath, "utf8");

  assert.match(jsonl, /FD-124-COMMIT/);
  assert.match(jsonl, /FD-124-UPSTREAM/);
  assert.match(jsonl, /expected_behavior/);
  assert.deepEqual(exportResult.recentRunFiles, [runPath]);
  const exportSummary = JSON.parse(await readFile(exportResult.summaryPath, "utf8"));
  assert.deepEqual(exportSummary.recentRunFiles, [runPath]);

  const scoreResult = await scoreFlowdeskExperiment({ workspaceRoot });
  await stat(scoreResult.outputPath);
  const summary = JSON.parse(await readFile(scoreResult.outputPath, "utf8"));

  assert.equal(summary.caseCount >= 5, true);
  assert.equal(summary.metrics.suggestedCommandValidity.total >= 1, true);
});
