import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";

import type { AgentRunMetadata } from "../agent/types.js";

export const EXPERIMENT_MARKER_FILENAME = ".git-helper-experiment.json";

export type ExperimentMarkerMetadata = {
  experiment: string;
  stage: string;
  case_id: string;
  recommended_command: string;
  expected_phase: string;
  created_at: string;
  results_dir?: string;
};

export type ExperimentMarker = {
  path: string;
  rootDir: string;
  metadata: ExperimentMarkerMetadata;
};

export type ExperimentRecorder = {
  runId: string;
  outputPath: string;
  marker: ExperimentMarker;
  record: (event: ExperimentRecordInput) => Promise<void>;
};

export type ExperimentRecordInput =
  | {
      type: "command_submitted";
      cwd: string;
      command: string;
    }
  | {
      type: "command_completed";
      cwd: string;
      command: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs?: number | undefined;
    }
  | {
      type: "agent_completed";
      cwd: string;
      command: string;
      phase: "beforeRun" | "afterSuccess" | "afterFail";
      agentKind: string;
      content: string;
      suggestedCommand?: string | undefined;
      metadata?: AgentRunMetadata | undefined;
    }
  | {
      type: "agent_failed";
      cwd: string;
      command: string;
      phase: "beforeRun" | "afterSuccess" | "afterFail";
      agentKind: string;
      error: string;
    };

type ExperimentRecorderOptions = {
  now?: () => string;
  runId?: string;
};

export async function findExperimentMarker(
  cwd: string = process.cwd(),
): Promise<ExperimentMarker | undefined> {
  let current = resolve(cwd);
  const root = parse(current).root;

  while (true) {
    const markerPath = join(current, EXPERIMENT_MARKER_FILENAME);
    const marker = await readExperimentMarker(markerPath);
    if (marker) {
      return {
        path: markerPath,
        rootDir: current,
        metadata: marker,
      };
    }

    if (current === root) {
      return undefined;
    }
    current = dirname(current);
  }
}

export async function createExperimentRecorder(
  cwd: string = process.cwd(),
  options: ExperimentRecorderOptions = {},
): Promise<ExperimentRecorder | undefined> {
  const marker = await findExperimentMarker(cwd);
  if (!marker) {
    return undefined;
  }

  const now = options.now ?? (() => new Date().toISOString());
  const runId = options.runId ?? createRunId(now());
  const resultsDir = marker.metadata.results_dir
    ? resolve(marker.metadata.results_dir)
    : join(marker.rootDir, ".experiments", "results");
  const outputPath = join(resultsDir, "runs", `${runId}.jsonl`);
  let nextEventId = 1;

  return {
    runId,
    outputPath,
    marker,
    async record(event) {
      const output = {
        type: event.type,
        run_id: runId,
        event_id: `${runId}-${nextEventId}`,
        timestamp: now(),
        experiment: marker.metadata.experiment,
        stage: marker.metadata.stage,
        case_id: marker.metadata.case_id,
        cwd: event.cwd,
        command: event.command,
        ...formatEventPayload(event),
      };
      nextEventId += 1;
      await mkdir(dirname(outputPath), { recursive: true });
      await appendFile(outputPath, `${JSON.stringify(output)}\n`);
    },
  };
}

async function readExperimentMarker(path: string): Promise<ExperimentMarkerMetadata | undefined> {
  try {
    return validateExperimentMarker(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return undefined;
  }
}

function validateExperimentMarker(value: unknown): ExperimentMarkerMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const marker = {
    experiment: readString(value.experiment),
    stage: readString(value.stage),
    case_id: readString(value.case_id),
    recommended_command: readString(value.recommended_command),
    expected_phase: readString(value.expected_phase),
    created_at: readString(value.created_at),
    results_dir: readString(value.results_dir),
  };

  if (
    !marker.experiment ||
    !marker.stage ||
    !marker.case_id ||
    !marker.recommended_command ||
    !marker.expected_phase ||
    !marker.created_at
  ) {
    return undefined;
  }

  return {
    experiment: marker.experiment,
    stage: marker.stage,
    case_id: marker.case_id,
    recommended_command: marker.recommended_command,
    expected_phase: marker.expected_phase,
    created_at: marker.created_at,
    ...(marker.results_dir ? { results_dir: marker.results_dir } : {}),
  };
}

function formatEventPayload(event: ExperimentRecordInput) {
  if (event.type === "command_submitted") {
    return {};
  }

  if (event.type === "command_completed") {
    return {
      exitCode: event.exitCode,
      stdout: event.stdout,
      stderr: event.stderr,
      ...(typeof event.durationMs === "number" ? { durationMs: event.durationMs } : {}),
    };
  }

  if (event.type === "agent_completed") {
    return {
      phase: event.phase,
      agentKind: event.agentKind,
      content: event.content,
      ...(event.suggestedCommand ? { suggestedCommand: event.suggestedCommand } : {}),
      ...(event.metadata ? { metadata: event.metadata } : {}),
    };
  }

  return {
    phase: event.phase,
    agentKind: event.agentKind,
    error: event.error,
  };
}

function createRunId(timestamp: string) {
  return `${timestamp.replace(/[:.]/g, "-")}-${randomUUID()}`;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
