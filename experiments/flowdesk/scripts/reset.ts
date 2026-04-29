import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
    recommendedCommand: "git pull --rebase origin main",
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
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const stage = options.stage ?? DEFAULT_STAGE;
  assertFlowdeskStage(stage);

  const generated = generatedRoot(workspaceRoot);
  const demo = projectDir(workspaceRoot);
  const remote = remoteDir(workspaceRoot);
  const docs = larkDocsDir(workspaceRoot);

  await rm(demo, { recursive: true, force: true });
  await rm(remote, { recursive: true, force: true });
  await rm(docs, { recursive: true, force: true });
  await mkdir(join(generated, "remotes"), { recursive: true });
  await mkdir(resultsDir(workspaceRoot), { recursive: true });

  await git(["init", "--bare", remote], workspaceRoot);
  await cp(join(fixturesRoot(), "project"), demo, { recursive: true });
  await cp(join(fixturesRoot(), "lark-docs"), docs, { recursive: true });

  await git(["init", "-b", "main"], demo);
  await configureGitUser(demo);
  await git(["add", "."], demo);
  await git(["commit", "-m", "chore: bootstrap flowdesk ticket module"], demo);
  await git(["remote", "add", "origin", remote], demo);
  await git(["push", "-u", "origin", "main"], demo);

  if (stage === "fresh") {
    return buildResetResult(workspaceRoot, stage);
  }

  await git(["switch", "-c", FEATURE_BRANCH], demo);
  await applyDevAChanges(demo);

  if (stage === "commit-message") {
    await git(["add", "flowdesk/tickets/filters.py", "flowdesk/tickets/service.py", "tests/test_ticket_filters.py"], demo);
    return buildResetResult(workspaceRoot, stage);
  }

  await git(["add", "."], demo);
  await git(["commit", "-m", "feat(tickets): add priority filter"], demo);

  if (stage === "upstream") {
    return buildResetResult(workspaceRoot, stage);
  }

  if (stage === "post-push") {
    await git(["push", "-u", "origin", FEATURE_BRANCH], demo);
    return buildResetResult(workspaceRoot, stage);
  }

  await git(["switch", "main"], demo);
  await applyDevBChanges(demo);
  await git(["add", "flowdesk/tickets/service.py"], demo);
  await git(["commit", "-m", "feat(tickets): sort tickets by priority"], demo);
  await git(["push", "origin", "main"], demo);
  await git(["switch", FEATURE_BRANCH], demo);
  return buildResetResult(workspaceRoot, stage);
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

function buildResetResult(workspaceRoot: string, stage: FlowdeskStage): FlowdeskResetResult {
  const details = STAGE_DETAILS[stage];
  return {
    stage,
    caseId: details.caseId,
    projectDir: projectDir(workspaceRoot),
    remoteDir: remoteDir(workspaceRoot),
    larkDocsDir: larkDocsDir(workspaceRoot),
    recommendedCommand: details.recommendedCommand,
    expectedPhase: details.expectedPhase,
  };
}

export async function exportFlowdeskCases(options: { workspaceRoot?: string } = {}) {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const cases = await readCaseDefinitions();
  const outputPath = join(resultsDir(workspaceRoot), "flowdesk-cases.jsonl");
  await mkdir(dirname(outputPath), { recursive: true });

  const lines = await Promise.all(
    cases.map(async (definition) => JSON.stringify({
      case_id: definition.case_id,
      phase: definition.phase,
      raw_command: definition.raw_command,
      stdout: "",
      stderr: sampleStderr(definition.case_id),
      git_diff: await sampleGitDiff(workspaceRoot, definition.case_id),
      retrieved_contexts: await resolveRetrievedContexts(definition.retrieved_contexts),
      agent_response: "",
      suggested_command: "",
      expected_behavior: definition.expected_behavior,
      acceptable_suggested_commands: definition.acceptable_suggested_commands,
    })),
  );

  await writeFile(outputPath, `${lines.join("\n")}\n`);
  return {
    outputPath,
    caseCount: cases.length,
  };
}

export async function scoreFlowdeskExperiment(options: { workspaceRoot?: string } = {}) {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const exportPath = join(resultsDir(workspaceRoot), "flowdesk-cases.jsonl");
  if (!(await pathExists(exportPath))) {
    await exportFlowdeskCases({ workspaceRoot });
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
  const outputPath = join(resultsDir(workspaceRoot), "flowdesk-score-summary.json");
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

async function sampleGitDiff(workspaceRoot: string, caseId: string) {
  if (caseId !== "FD-124-COMMIT") {
    return "";
  }

  const demo = projectDir(workspaceRoot);
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
