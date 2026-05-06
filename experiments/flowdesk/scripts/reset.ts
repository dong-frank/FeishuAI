import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const FLOWDESK_STAGES = [
  "fresh",
  "commit-message",
  "conflict",
  "upstream",
  "post-push",
] as const;

export type FlowdeskStage = (typeof FLOWDESK_STAGES)[number];

export type FlowdeskExperimentOptions = {
  workspaceRoot?: string;
  stage?: FlowdeskStage;
};

export type FlowdeskResetResult = {
  stage: FlowdeskStage;
  caseId: string;
  projectDir: string;
  remoteDir: string;
  larkDocsDir: string;
  resultsDir: string;
  runDataDir: string;
  recommendedCommand: string;
  expectedPhase: string;
};

type CaseDefinition = {
  case_id: string;
  phase: string;
  raw_command: string;
  expected_behavior: string;
  retrieved_contexts: string[];
  acceptable_suggested_commands: string[];
};

const FEATURE_BRANCH = "feature/fd-124-priority-filter";
const DEFAULT_STAGE: FlowdeskStage = "fresh";
const DEFAULT_HOME_DATA_DIR = join(homedir(), ".gitx-flowdesk");
const DEFAULT_HOME_PROJECT_DIR = join(homedir(), "flowdesk-demo");
const FLOWDESK_FIXTURE_MARKER = "FlowDesk is a lightweight SaaS ticketing backend";
const EXPERIMENT_MARKER_FILENAME = ".gitx-experiment.json";

export type FlowdeskLayout = {
  workspaceRoot: string;
  generatedRoot: string;
  projectDir: string;
  remoteDir: string;
  larkDocsDir: string;
  resultsDir: string;
  runDataDir: string;
};

const STAGE_DETAILS: Record<FlowdeskStage, {
  caseId: string;
  expectedPhase: string;
  recommendedCommand: string;
}> = {
  fresh: {
    caseId: "FD-124-FRESH",
    expectedPhase: "none",
    recommendedCommand: "git status",
  },
  "commit-message": {
    caseId: "FD-124-COMMIT",
    expectedPhase: "beforeRun",
    recommendedCommand: "git commit",
  },
  conflict: {
    caseId: "FD-124-CONFLICT",
    expectedPhase: "afterFail",
    recommendedCommand: "git merge origin/main",
  },
  upstream: {
    caseId: "FD-124-UPSTREAM",
    expectedPhase: "afterFail",
    recommendedCommand: "git push",
  },
  "post-push": {
    caseId: "FD-124-POST-PUSH",
    expectedPhase: "afterSuccess",
    recommendedCommand: `git push -u origin ${FEATURE_BRANCH}`,
  },
};

function experimentRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function fixturesRoot() {
  return join(experimentRoot(), "fixtures");
}

function generatedRoot(workspaceRoot: string) {
  return join(workspaceRoot, ".experiments");
}

function projectDir(workspaceRoot: string) {
  return join(generatedRoot(workspaceRoot), "flowdesk-demo");
}

function remoteDir(workspaceRoot: string) {
  return join(generatedRoot(workspaceRoot), "remotes", "flowdesk-demo.git");
}

function larkDocsDir(workspaceRoot: string) {
  return join(generatedRoot(workspaceRoot), "flowdesk-lark-docs");
}

function resultsDir(workspaceRoot: string) {
  return join(generatedRoot(workspaceRoot), "results");
}

function runDataDir(workspaceRoot: string) {
  return join(resultsDir(workspaceRoot), "runs");
}

export function getDefaultFlowdeskLayout(): FlowdeskLayout {
  return {
    workspaceRoot: homedir(),
    generatedRoot: DEFAULT_HOME_DATA_DIR,
    projectDir: DEFAULT_HOME_PROJECT_DIR,
    remoteDir: join(DEFAULT_HOME_DATA_DIR, "remotes", "flowdesk-demo.git"),
    larkDocsDir: join(DEFAULT_HOME_DATA_DIR, "lark-docs"),
    resultsDir: join(DEFAULT_HOME_DATA_DIR, "results"),
    runDataDir: join(DEFAULT_HOME_DATA_DIR, "results", "runs"),
  };
}

function resolveFlowdeskLayout(workspaceRoot?: string): FlowdeskLayout {
  if (!workspaceRoot) {
    return getDefaultFlowdeskLayout();
  }

  const root = resolve(workspaceRoot);
  return {
    workspaceRoot: root,
    generatedRoot: generatedRoot(root),
    projectDir: projectDir(root),
    remoteDir: remoteDir(root),
    larkDocsDir: larkDocsDir(root),
    resultsDir: resultsDir(root),
    runDataDir: runDataDir(root),
  };
}

async function git(args: string[], cwd: string) {
  return execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024 * 10,
  });
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function assertFlowdeskStage(stage: string): asserts stage is FlowdeskStage {
  if (!FLOWDESK_STAGES.includes(stage as FlowdeskStage)) {
    throw new Error(`Unknown FlowDesk stage "${stage}". Expected one of: ${FLOWDESK_STAGES.join(", ")}`);
  }
}

export async function resetFlowdeskExperiment(
  options: FlowdeskExperimentOptions = {},
): Promise<FlowdeskResetResult> {
  const stage = options.stage ?? DEFAULT_STAGE;
  assertFlowdeskStage(stage);
  const layout = resolveFlowdeskLayout(options.workspaceRoot);

  const generated = layout.generatedRoot;
  const demo = layout.projectDir;
  const remote = layout.remoteDir;
  const docs = layout.larkDocsDir;

  await assertSafeToReplaceFlowdeskProject(demo);
  await rm(demo, { recursive: true, force: true });
  await rm(remote, { recursive: true, force: true });
  await rm(docs, { recursive: true, force: true });
  await mkdir(join(generated, "remotes"), { recursive: true });
  await mkdir(layout.runDataDir, { recursive: true });

  await git(["init", "--bare", remote], layout.workspaceRoot);
  await cp(join(fixturesRoot(), "project"), demo, { recursive: true });
  await cp(join(fixturesRoot(), "lark-docs"), docs, { recursive: true });

  await git(["init", "-b", "main"], demo);
  await configureGitUser(demo);
  await git(["add", "."], demo);
  await git(["commit", "-m", "chore: bootstrap flowdesk ticket module"], demo);
  await git(["remote", "add", "origin", remote], demo);
  await git(["push", "-u", "origin", "main"], demo);

  if (stage === "fresh") {
    return writeAndBuildResetResult(layout, stage);
  }

  await git(["switch", "-c", FEATURE_BRANCH], demo);
  await applyDevAChanges(demo);

  if (stage === "commit-message") {
    await git(["add", "flowdesk/tickets/filters.py", "flowdesk/tickets/service.py", "tests/test_ticket_filters.py"], demo);
    return writeAndBuildResetResult(layout, stage);
  }

  await git(["add", "."], demo);
  await git(["commit", "-m", "feat(tickets): add priority filter"], demo);

  if (stage === "upstream") {
    return writeAndBuildResetResult(layout, stage);
  }

  if (stage === "post-push") {
    await git(["push", "-u", "origin", FEATURE_BRANCH], demo);
    return writeAndBuildResetResult(layout, stage);
  }

  await git(["switch", "main"], demo);
  await applyDevBChanges(demo);
  await git(["add", "flowdesk/tickets/service.py"], demo);
  await git(["commit", "-m", "feat(tickets): sort tickets by priority"], demo);
  await git(["push", "origin", "main"], demo);
  await git(["switch", FEATURE_BRANCH], demo);
  return writeAndBuildResetResult(layout, stage);
}

async function assertSafeToReplaceFlowdeskProject(demo: string) {
  if (!(await pathExists(demo))) {
    return;
  }

  const markerPath = join(demo, EXPERIMENT_MARKER_FILENAME);
  if (await pathExists(markerPath)) {
    try {
      const marker = JSON.parse(await readFile(markerPath, "utf8"));
      if (marker.experiment === "flowdesk") {
        return;
      }
    } catch {
      // Continue to the fixture README check.
    }
  }

  try {
    const readme = await readFile(join(demo, "README.md"), "utf8");
    if (readme.includes(FLOWDESK_FIXTURE_MARKER)) {
      return;
    }
  } catch {
    // Continue to the refusal below.
  }

  throw new Error(
    `Refusing to replace ${demo}: it does not look like a FlowDesk experiment directory.`,
  );
}

async function configureGitUser(cwd: string) {
  await git(["config", "user.name", "FlowDesk Experiment"], cwd);
  await git(["config", "user.email", "flowdesk@example.local"], cwd);
}

async function applyDevAChanges(demo: string) {
  await writeFile(
    join(demo, "flowdesk/tickets/filters.py"),
    [
      "from .models import Ticket",
      "",
      "",
      "def filter_tickets(",
      "    tickets: list[Ticket],",
      "    status: str | None = None,",
      "    priority: str | None = None,",
      ") -> list[Ticket]:",
      "    filtered = tickets",
      "",
      "    if status is not None:",
      "        filtered = [ticket for ticket in filtered if ticket.status == status]",
      "",
      "    if priority is not None:",
      "        filtered = [ticket for ticket in filtered if ticket.priority == priority]",
      "",
      "    return filtered",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(demo, "flowdesk/tickets/service.py"),
    [
      "from .filters import filter_tickets",
      "from .models import Ticket",
      "",
      "",
      "def list_tickets(",
      "    tickets: list[Ticket],",
      "    status: str | None = None,",
      "    priority: str | None = None,",
      ") -> list[Ticket]:",
      "    filtered = filter_tickets(tickets, status=status, priority=priority)",
      "    return sorted(filtered, key=lambda ticket: ticket.id)",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(demo, "tests/test_ticket_filters.py"),
    [
      "from flowdesk.tickets.filters import filter_tickets",
      "from flowdesk.tickets.models import Ticket",
      "",
      "",
      "def sample_tickets():",
      "    return [",
      "        Ticket(id=1, title=\"Login issue\", status=\"Open\", priority=\"High\"),",
      "        Ticket(id=2, title=\"Billing question\", status=\"Closed\", priority=\"Low\"),",
      "        Ticket(id=3, title=\"Export failed\", status=\"Open\", priority=\"Medium\"),",
      "    ]",
      "",
      "",
      "def test_filters_tickets_by_status():",
      "    result = filter_tickets(sample_tickets(), status=\"Open\")",
      "",
      "    assert [ticket.id for ticket in result] == [1, 3]",
      "",
      "",
      "def test_filters_tickets_by_priority():",
      "    result = filter_tickets(sample_tickets(), priority=\"High\")",
      "",
      "    assert [ticket.id for ticket in result] == [1]",
      "",
      "",
      "def test_filters_tickets_by_status_and_priority():",
      "    result = filter_tickets(sample_tickets(), status=\"Open\", priority=\"Medium\")",
      "",
      "    assert [ticket.id for ticket in result] == [3]",
      "",
    ].join("\n"),
  );
}

async function applyDevBChanges(demo: string) {
  await writeFile(
    join(demo, "flowdesk/tickets/service.py"),
    [
      "from .filters import filter_tickets",
      "from .models import Ticket",
      "",
      "",
      "PRIORITY_ORDER = {\"High\": 0, \"Medium\": 1, \"Low\": 2}",
      "",
      "",
      "def list_tickets(tickets: list[Ticket], status: str | None = None) -> list[Ticket]:",
      "    filtered = filter_tickets(tickets, status=status)",
      "    return sorted(filtered, key=lambda ticket: (PRIORITY_ORDER.get(ticket.priority, 99), ticket.id))",
      "",
    ].join("\n"),
  );
}

async function writeAndBuildResetResult(
  layout: FlowdeskLayout,
  stage: FlowdeskStage,
): Promise<FlowdeskResetResult> {
  const result = buildResetResult(layout, stage);
  await writeExperimentMarker(result);
  return result;
}

async function writeExperimentMarker(result: FlowdeskResetResult) {
  await writeFile(
    join(result.projectDir, EXPERIMENT_MARKER_FILENAME),
    `${JSON.stringify({
      experiment: "flowdesk",
      stage: result.stage,
      case_id: result.caseId,
      recommended_command: result.recommendedCommand,
      expected_phase: result.expectedPhase,
      results_dir: result.resultsDir,
      created_at: new Date().toISOString(),
    }, null, 2)}\n`,
  );
}

function buildResetResult(layout: FlowdeskLayout, stage: FlowdeskStage): FlowdeskResetResult {
  const details = STAGE_DETAILS[stage];
  return {
    stage,
    caseId: details.caseId,
    projectDir: layout.projectDir,
    remoteDir: layout.remoteDir,
    larkDocsDir: layout.larkDocsDir,
    resultsDir: layout.resultsDir,
    runDataDir: layout.runDataDir,
    recommendedCommand: details.recommendedCommand,
    expectedPhase: details.expectedPhase,
  };
}

export async function exportFlowdeskCases(options: { workspaceRoot?: string } = {}) {
  const layout = resolveFlowdeskLayout(options.workspaceRoot);
  const cases = await readCaseDefinitions();
  const outputPath = join(layout.resultsDir, "flowdesk-cases.jsonl");
  const summaryPath = join(layout.resultsDir, "flowdesk-export-summary.json");
  await mkdir(dirname(outputPath), { recursive: true });

  const lines = await Promise.all(
    cases.map(async (definition) => JSON.stringify({
      case_id: definition.case_id,
      phase: definition.phase,
      raw_command: definition.raw_command,
      stdout: "",
      stderr: sampleStderr(definition.case_id),
      git_diff: await sampleGitDiff(layout, definition.case_id),
      retrieved_contexts: await resolveRetrievedContexts(definition.retrieved_contexts),
      agent_response: "",
      suggested_command: "",
      expected_behavior: definition.expected_behavior,
      acceptable_suggested_commands: definition.acceptable_suggested_commands,
    })),
  );

  await writeFile(outputPath, `${lines.join("\n")}\n`);
  const recentRunFiles = await listRecentRunFiles(layout);
  await writeFile(
    summaryPath,
    `${JSON.stringify({
      casesPath: outputPath,
      caseCount: cases.length,
      recentRunFiles,
      exportedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
  return {
    outputPath,
    summaryPath,
    caseCount: cases.length,
    recentRunFiles,
  };
}

async function listRecentRunFiles(layout: FlowdeskLayout, limit = 5) {
  const runs = layout.runDataDir;
  if (!(await pathExists(runs))) {
    return [];
  }

  const entries = await readdir(runs, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map(async (entry) => {
        const path = join(runs, entry.name);
        const fileStat = await stat(path);
        return {
          path,
          mtimeMs: fileStat.mtimeMs,
        };
      }),
  );

  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limit)
    .map((file) => file.path);
}

export async function scoreFlowdeskExperiment(options: { workspaceRoot?: string } = {}) {
  const layout = resolveFlowdeskLayout(options.workspaceRoot);
  const exportPath = join(layout.resultsDir, "flowdesk-cases.jsonl");
  if (!(await pathExists(exportPath))) {
    await exportFlowdeskCases(options);
  }

  const content = await readFile(exportPath, "utf8");
  const samples = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const commandCases = samples.filter((sample) =>
    Array.isArray(sample.acceptable_suggested_commands) &&
    sample.acceptable_suggested_commands.length > 0
  );
  const outputPath = join(layout.resultsDir, "flowdesk-score-summary.json");
  const summary = {
    evaluator: "deterministic-placeholder",
    note: "Replace with Ragas once real agent responses are exported.",
    caseCount: samples.length,
    metrics: {
      responseRelevancy: {
        average: null,
        status: "pending_agent_responses",
      },
      faithfulness: {
        average: null,
        status: "pending_agent_responses",
      },
      contextUtilization: {
        average: null,
        status: "pending_agent_responses",
      },
      suggestedCommandValidity: {
        valid: 0,
        total: commandCases.length,
        status: "pending_agent_responses",
      },
      latency: {
        averageMs: null,
        status: "pending_agent_responses",
      },
    },
  };

  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  return {
    outputPath,
    summary,
  };
}

async function readCaseDefinitions(): Promise<CaseDefinition[]> {
  return JSON.parse(await readFile(join(fixturesRoot(), "expected", "cases.json"), "utf8"));
}

function sampleStderr(caseId: string) {
  if (caseId === "FD-124-UPSTREAM") {
    return `fatal: The current branch ${FEATURE_BRANCH} has no upstream branch.`;
  }
  if (caseId === "FD-124-CONFLICT") {
    return "CONFLICT (content): Merge conflict in flowdesk/tickets/service.py";
  }
  return "";
}

async function sampleGitDiff(layout: FlowdeskLayout, caseId: string) {
  if (caseId !== "FD-124-COMMIT") {
    return "";
  }

  const demo = layout.projectDir;
  if (!(await pathExists(join(demo, ".git")))) {
    return "";
  }

  try {
    const result = await git(["diff", "--cached"], demo);
    return result.stdout;
  } catch {
    return "";
  }
}

async function resolveRetrievedContexts(names: string[]) {
  return Promise.all(
    names.map(async (name) => {
      if (name.startsWith("git ")) {
        return {
          title: name,
          content: "",
        };
      }
      const path = join(fixturesRoot(), "lark-docs", `${name}.md`);
      return {
        title: name,
        content: await readFile(path, "utf8"),
      };
    }),
  );
}

function parseCli(argv: string[]) {
  const command = argv[0] ?? "reset";
  const stageIndex = argv.indexOf("--stage");
  const stage = stageIndex >= 0 ? argv[stageIndex + 1] : undefined;
  if (stage !== undefined) {
    assertFlowdeskStage(stage);
  }
  return {
    command,
    stage: stage ?? DEFAULT_STAGE,
  };
}

function printResetResult(result: FlowdeskResetResult) {
  console.log([
    `FlowDesk stage: ${result.stage}`,
    `Case ID: ${result.caseId}`,
    `Project: ${result.projectDir}`,
    `Remote: ${result.remoteDir}`,
    `Lark docs: ${result.larkDocsDir}`,
    `Run data: ${result.runDataDir}`,
    `Current branch: ${result.stage === "fresh" ? "main" : FEATURE_BRANCH}`,
    `Recommended command: ${result.recommendedCommand}`,
    `Expected phase: ${result.expectedPhase}`,
  ].join("\n"));
}

async function main() {
  const { command, stage } = parseCli(process.argv.slice(2));
  if (command === "reset") {
    printResetResult(await resetFlowdeskExperiment({ stage }));
    return;
  }
  if (command === "export") {
    const result = await exportFlowdeskCases();
    console.log(`Exported ${result.caseCount} FlowDesk cases to ${result.outputPath}`);
    console.log(`Wrote export summary to ${result.summaryPath}`);
    if (result.recentRunFiles.length > 0) {
      console.log(`Recent run files:\n${result.recentRunFiles.join("\n")}`);
    } else {
      console.log("Recent run files: none");
    }
    return;
  }
  if (command === "score") {
    const result = await scoreFlowdeskExperiment();
    console.log(`Wrote FlowDesk score summary to ${result.outputPath}`);
    return;
  }

  throw new Error(`Unknown FlowDesk experiment command "${command}". Use reset, export, or score.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
