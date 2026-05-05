import type {
  AgentRunMetadata,
  AgentTokenUsage,
  AgentToolProgressEvent,
} from "../agent/types.js";
import type { CommandRunOutput } from "../runtime/command-runner.js";
import {
  DEFAULT_HISTORY_VIEWPORT_HEIGHT,
  INPUT_HISTORY_MARGIN_BOTTOM,
  MIN_HISTORY_VIEWPORT_HEIGHT,
  RESERVED_TUI_CHROME_ROWS,
  WELCOME_BANNER_LINES,
  WELCOME_SUBTITLE,
} from "./constants.js";
import {
  getOutputSections,
  getOutputTextParts,
  getRenderedOutputText,
  isHelpOutput,
  type OutputTextPart,
} from "./output.js";
import { getStatusLine, getTerminalTextWidth } from "./status.js";

type HistoryColor = NonNullable<OutputTextPart["color"]>;
type OutputSource = "user" | "agent";
type AgentHistoryKind = "command" | "lark";
type AgentHistoryState = "pending" | "success" | "failed" | "empty";
type AgentHistoryActivity = "waiting" | "reviewing";
const AGENT_TOOL_PROGRESS_DISPLAY_WIDTH = 50;

export type AgentHistoryEntry = {
  type: "agent";
  id: string;
  agentKind: AgentHistoryKind;
  commandLine: string;
  state: AgentHistoryState;
  activity?: AgentHistoryActivity | undefined;
  content?: string | undefined;
  error?: string | undefined;
  metadata?: AgentRunMetadata | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  toolProgress?: AgentToolProgressEvent[] | undefined;
};

export type HistoryEntry =
  | {
      type: "input";
      text: string;
    }
  | {
      type: "output";
      result: CommandRunOutput;
      source?: OutputSource | undefined;
    }
  | {
      type: "system";
      text: string;
    }
  | AgentHistoryEntry;

export type HistoryRow = {
  text: string;
  rightText?: string | undefined;
  rightColor?: HistoryColor | undefined;
  parts?: OutputTextPart[] | undefined;
  color?: HistoryColor | undefined;
  bold?: boolean | undefined;
};

export type HistoryScrollAction = "pageUp" | "pageDown" | "wheelUp" | "wheelDown";

export function getHistoryViewportHeight(rows: number | undefined) {
  if (!rows) {
    return DEFAULT_HISTORY_VIEWPORT_HEIGHT;
  }

  return Math.max(MIN_HISTORY_VIEWPORT_HEIGHT, rows - RESERVED_TUI_CHROME_ROWS);
}

export function getHistoryViewportWidth(columns: number | undefined) {
  if (!columns) {
    return undefined;
  }

  return Math.max(8, columns - 4);
}

export function getVisibleHistoryRows(
  history: HistoryEntry[],
  rowLimit: number,
  scrollOffset: number = 0,
  wrapWidth?: number | undefined,
) {
  if (rowLimit <= 0) {
    return [];
  }

  const rows = getHistoryRows(history, wrapWidth);
  const safeOffset = Math.min(Math.max(scrollOffset, 0), Math.max(0, rows.length - rowLimit));
  const end = rows.length - safeOffset;
  return rows.slice(Math.max(0, end - rowLimit), end);
}

export function getNextHistoryScrollOffset(
  currentOffset: number,
  action: HistoryScrollAction,
  totalRows: number,
  viewportRows: number,
) {
  const maxOffset = Math.max(0, totalRows - viewportRows);
  const pageSize = Math.max(1, viewportRows);
  const deltaByAction: Record<HistoryScrollAction, number> = {
    pageUp: pageSize,
    pageDown: -pageSize,
    wheelUp: Math.min(3, pageSize),
    wheelDown: -Math.min(3, pageSize),
  };
  const nextOffset = currentOffset + deltaByAction[action];
  return Math.min(maxOffset, Math.max(0, nextOffset));
}

export function getHistoryRows(
  history: HistoryEntry[],
  wrapWidth?: number | undefined,
): HistoryRow[] {
  return [
    ...WELCOME_BANNER_LINES.map((line) => ({
      text: line,
      color: "yellow" as const,
      bold: true,
    })),
    {
      text: WELCOME_SUBTITLE,
      color: "gray",
    },
    { text: "" },
    ...history.flatMap((entry, index) =>
      getHistoryEntryRows(entry, wrapWidth, history[index + 1]),
    ),
  ];
}

function getHistoryEntryRows(
  entry: HistoryEntry,
  wrapWidth?: number | undefined,
  nextEntry?: HistoryEntry | undefined,
): HistoryRow[] {
  if (entry.type === "input") {
    const color = isFailedOutputForCommand(nextEntry, entry.text) ? "red" : "green";
    const statusText = getCommandStatusText(nextEntry, entry.text);
    const commandRows = splitPlainTextRows(`$ ${entry.text}`, { color }, wrapWidth);
    return [
      ...attachCommandStatus(commandRows, statusText, color),
      ...Array.from({ length: INPUT_HISTORY_MARGIN_BOTTOM }, () => ({ text: "" })),
    ];
  }

  if (entry.type === "system") {
    return splitPlainTextRows(entry.text, { color: "gray" }, wrapWidth);
  }

  if (entry.type === "agent") {
    return getAgentHistoryEntryRows(entry, wrapWidth);
  }

  if (isHelpOutput(entry.result)) {
    const output = getOutputSections(entry.result);
    return [
      { text: "" },
      {
        text: getAgentHistoryTitle(),
        color: "cyan",
        bold: true,
        rightText: formatAgentMetadata(entry.result.agentMetadata),
        rightColor: "cyan",
      },
      ...splitPlainTextRows(getRenderedOutputText(output), { color: "cyan" }, wrapWidth),
      { text: "" },
    ];
  }

  const isAgentOutput = entry.source === "agent";
  const outputRows = splitOutputPartsIntoRows(
    getStyledOutputTextParts(getOutputTextParts(entry.result), entry.source),
  );
  const rows = isAgentOutput
    ? [
        {
          text: `agent: ${entry.result.commandLine}`,
          color: "magenta" as const,
          bold: true,
        },
        ...outputRows,
      ]
    : outputRows;

  return rows;
}

export function replaceAgentHistoryEntry(
  history: HistoryEntry[],
  id: string,
  patch: Partial<Omit<AgentHistoryEntry, "type" | "id" | "agentKind" | "commandLine">>,
): HistoryEntry[] {
  return history.map((entry) =>
    entry.type === "agent" && entry.id === id
      ? {
          ...entry,
          ...patch,
        }
      : entry,
  );
}

export function omitCompletedAgentToolProgress(history: HistoryEntry[]): HistoryEntry[] {
  return history.map((entry) => {
    if (entry.type !== "agent" || entry.state === "pending" || !entry.toolProgress) {
      return entry;
    }

    const { toolProgress: _toolProgress, ...rest } = entry;
    return rest;
  });
}

export function upsertAgentToolProgress(
  current: AgentToolProgressEvent[],
  event: AgentToolProgressEvent,
) {
  const existingIndex = current.findIndex(
    (candidate) => candidate.id === event.id && candidate.agentKind === event.agentKind,
  );
  const next =
    existingIndex >= 0
      ? current.map((candidate, index) => (index === existingIndex ? event : candidate))
      : [...current, event];
  return next;
}

function isFailedOutputForCommand(
  entry: HistoryEntry | undefined,
  commandLine: string,
) {
  return (
    entry?.type === "output" &&
    entry.result.commandLine === commandLine &&
    entry.result.exitCode !== 0
  );
}

function getCommandStatusText(
  entry: HistoryEntry | undefined,
  commandLine: string,
) {
  if (
    entry?.type !== "output" ||
    entry.result.kind !== "execute" ||
    entry.result.commandLine !== commandLine ||
    typeof entry.result.durationMs !== "number"
  ) {
    return undefined;
  }

  const duration = formatCommandDuration(entry.result.durationMs);
  if (entry.result.exitCode === 0) {
    return `✓ ${duration}`;
  }

  return `✗ ${entry.result.exitCode} ${duration}`;
}

export function formatCommandDuration(durationMs: number) {
  const safeDurationMs = Math.max(0, Math.round(durationMs));
  if (safeDurationMs < 1000) {
    return `${safeDurationMs}ms`;
  }

  if (safeDurationMs < 60_000) {
    const seconds = safeDurationMs / 1000;
    const precision = safeDurationMs < 10_000 ? 1 : 0;
    return `${seconds.toFixed(precision).replace(/\.0$/, "")}s`;
  }

  const minutes = Math.floor(safeDurationMs / 60_000);
  const seconds = Math.round((safeDurationMs % 60_000) / 1000);
  return `${minutes}m${seconds}s`;
}

function formatAgentMetadata(metadata: AgentRunMetadata | undefined) {
  if (!metadata) {
    return undefined;
  }

  const parts = [`✓ ${formatCommandDuration(metadata.durationMs)}`];
  const tokenCount = getAgentTokenCount(metadata.tokenUsage);
  if (typeof tokenCount === "number") {
    parts.push(`${tokenCount} tokens`);
  }
  const contextTokenCount = metadata.contextUsage?.estimatedTokens;
  if (typeof contextTokenCount === "number") {
    parts.push(`ctx ${contextTokenCount} tokens`);
  }

  return `[${parts.join(" · ")}]`;
}

function getAgentHistoryEntryRows(
  entry: AgentHistoryEntry,
  wrapWidth?: number | undefined,
): HistoryRow[] {
  const outputRows = splitOutputPartsIntoRows(
    getStyledOutputTextParts(
      getOutputTextParts({
        commandLine: entry.commandLine,
        kind: "execute",
        exitCode: entry.state === "failed" ? 1 : 0,
        stdout: entry.stdout ?? "",
        stderr: entry.stderr ?? "",
      }),
      "agent",
    ),
  );
  const bodyRows = getAgentHistoryBodyRows(entry, wrapWidth);

  return [
    { text: "" },
    {
      text: getAgentHistoryTitle(),
      color: "cyan",
      bold: true,
      rightText: getAgentHistoryRightText(entry),
      rightColor: getAgentHistoryRightColor(entry),
    },
    ...outputRows,
    ...getAgentToolProgressRows(entry, wrapWidth),
    ...bodyRows,
    { text: "" },
  ];
}

function getAgentToolProgressRows(
  entry: AgentHistoryEntry,
  wrapWidth?: number | undefined,
): HistoryRow[] {
  if (!entry.toolProgress?.length) {
    return [];
  }

  return entry.toolProgress.flatMap((event, index) =>
    getAgentToolProgressEventRows(
      event,
      index === entry.toolProgress!.length - 1,
      entry.agentKind,
      wrapWidth,
    ),
  );
}

function getAgentToolProgressEventRows(
  event: AgentToolProgressEvent,
  isLast: boolean,
  fallbackAgentKind: AgentHistoryKind,
  wrapWidth?: number | undefined,
): HistoryRow[] {
  const color = getAgentToolProgressColor(event);
  const agentKind = event.agentKind ?? fallbackAgentKind;
  const labelRows = splitTerminalTextByWidth(
    formatAgentToolProgressLabel(event, isLast),
    wrapWidth,
  );
  const [firstLabel = ""] = labelRows;
  const rows: HistoryRow[] = [
    {
      text: firstLabel,
      color,
      rightText: `[${getAgentToolProgressAgentTitle(agentKind)}]`,
      rightColor: getAgentToolProgressAgentColor(agentKind),
    },
    ...labelRows.slice(1).map((text) => ({
      text,
      color,
    })),
  ];

  return rows;
}

function formatAgentToolProgressLabel(event: AgentToolProgressEvent, isLast: boolean) {
  const connector = isLast ? "└─" : "├─";
  const summary = event.inputSummary ? ` ${event.inputSummary}` : "";
  const display = truncateTerminalTextByWidth(
    `${event.toolName}${summary}`,
    AGENT_TOOL_PROGRESS_DISPLAY_WIDTH,
  );
  return `  ${connector} ${display}`;
}

function truncateTerminalTextByWidth(text: string, maxWidth: number) {
  if (maxWidth <= 0 || getTerminalTextWidth(text) <= maxWidth) {
    return text;
  }

  const suffix = "...";
  const suffixWidth = getTerminalTextWidth(suffix);
  const targetWidth = Math.max(0, maxWidth - suffixWidth);
  let current = "";
  let currentWidth = 0;

  for (const character of Array.from(text)) {
    const characterWidth = getTerminalTextWidth(character);
    if (currentWidth + characterWidth > targetWidth) {
      break;
    }

    current += character;
    currentWidth += characterWidth;
  }

  return `${current}${suffix}`;
}

function getAgentToolProgressColor(event: AgentToolProgressEvent): HistoryColor {
  if (event.state === "running") {
    return "magenta";
  }

  if (event.state === "failed") {
    return "red";
  }

  return "gray";
}

function getAgentToolProgressAgentColor(agentKind: AgentHistoryKind): HistoryColor {
  return agentKind === "lark" ? "magenta" : "cyan";
}

function getAgentHistoryBodyRows(
  entry: AgentHistoryEntry,
  wrapWidth?: number | undefined,
): HistoryRow[] {
  if (entry.state === "failed") {
    return splitPlainTextRows(entry.error?.trim() || "Agent failed.", { color: "red" }, wrapWidth);
  }

  if (entry.state === "empty") {
    return splitPlainTextRows("No agent suggestion generated.", { color: "gray" }, wrapWidth);
  }

  if (entry.content?.trim()) {
    return splitPlainTextRows(entry.content.trim(), { color: "cyan" }, wrapWidth);
  }

  if (entry.state === "pending") {
    return splitPlainTextRows("Waiting for agent response...", { color: "gray" }, wrapWidth);
  }

  return [];
}

function getAgentHistoryRightText(entry: AgentHistoryEntry) {
  if (entry.state === "pending") {
    return `[${getPendingAgentStatusText(entry)}]`;
  }

  if (entry.state === "failed") {
    return "[failed]";
  }

  if (entry.state === "empty") {
    return "[done]";
  }

  return formatAgentMetadata(entry.metadata) ?? "[done]";
}

function getPendingAgentStatusText(entry: AgentHistoryEntry) {
  return getStatusLine({
    isRunning: false,
    isAgentWaiting: entry.activity !== "reviewing",
    isAgentReviewing: entry.activity === "reviewing",
    agentKind: entry.agentKind,
    agentCommand: entry.commandLine,
  });
}

function getAgentHistoryRightColor(entry: AgentHistoryEntry): HistoryColor {
  if (entry.state === "pending") {
    return "yellow";
  }

  if (entry.state === "failed") {
    return "red";
  }

  if (entry.state === "empty") {
    return "gray";
  }

  return "cyan";
}

function getAgentHistoryTitle() {
  return "GITX";
}

function getAgentToolProgressAgentTitle(agentKind: "command" | "lark" | undefined) {
  if (agentKind === "lark") {
    return "Lark Agent";
  }

  return "Git Agent";
}

function getAgentTokenCount(tokenUsage: AgentTokenUsage | undefined) {
  return tokenUsage?.totalTokens;
}

function attachCommandStatus(
  rows: HistoryRow[],
  statusText: string | undefined,
  statusColor: HistoryColor,
) {
  if (!statusText || rows.length === 0) {
    return rows;
  }

  const nextRows = [...rows];
  const lastRow = nextRows[nextRows.length - 1];
  if (!lastRow) {
    return rows;
  }

  nextRows[nextRows.length - 1] = {
    ...lastRow,
    rightText: `[${statusText}]`,
    rightColor: statusColor,
  };
  return nextRows;
}

function splitPlainTextRows(
  text: string,
  style: Pick<HistoryRow, "color" | "bold"> = {},
  wrapWidth?: number | undefined,
): HistoryRow[] {
  return text
    .split("\n")
    .flatMap((line) => splitTerminalTextByWidth(line, wrapWidth))
    .map((line) => ({
      text: line,
      ...style,
    }));
}

function splitTerminalTextByWidth(
  text: string,
  wrapWidth: number | undefined,
): string[] {
  if (!wrapWidth || wrapWidth <= 0 || getTerminalTextWidth(text) <= wrapWidth) {
    return [text];
  }

  const rows: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (const character of Array.from(text)) {
    const characterWidth = getTerminalTextWidth(character);
    if (current && currentWidth + characterWidth > wrapWidth) {
      rows.push(current);
      current = "";
      currentWidth = 0;
    }

    current += character;
    currentWidth += characterWidth;
  }

  rows.push(current);
  return rows;
}

function getStyledOutputTextParts(
  parts: OutputTextPart[],
  source: OutputSource | undefined,
): OutputTextPart[] {
  if (source !== "agent") {
    return parts;
  }

  return parts.map((part) => ({
    ...part,
    color: part.color ?? "magenta",
  }));
}

function splitOutputPartsIntoRows(parts: OutputTextPart[]): HistoryRow[] {
  const rows: OutputTextPart[][] = [[]];

  for (const part of parts) {
    const lines = part.text.split("\n");
    for (const [index, line] of lines.entries()) {
      if (index > 0) {
        rows.push([]);
      }

      if (line) {
        rows[rows.length - 1]?.push({
          ...part,
          text: line,
        });
      }
    }
  }

  if (rows.length > 1 && rows[rows.length - 1]?.length === 0) {
    rows.pop();
  }

  return rows.map((partsForRow) => ({
    text: partsForRow.map((part) => part.text).join(""),
    parts: partsForRow,
  }));
}
