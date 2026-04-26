import type { CommandRunOutput } from "../runtime/command-runner.js";
import {
  DEFAULT_HISTORY_VIEWPORT_HEIGHT,
  INPUT_HISTORY_MARGIN_BOTTOM,
  MIN_HISTORY_VIEWPORT_HEIGHT,
  RESERVED_TUI_CHROME_ROWS,
  WELCOME_SUBTITLE,
  WELCOME_TITLE,
} from "./constants.js";
import {
  getOutputSections,
  getOutputTextParts,
  getRenderedOutputText,
  isHelpOutput,
  type OutputTextPart,
} from "./output.js";

type HistoryColor = NonNullable<OutputTextPart["color"]>;
type OutputSource = "user" | "agent";

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
    };

export type HistoryRow = {
  text: string;
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

export function getVisibleHistoryRows(
  history: HistoryEntry[],
  rowLimit: number,
  scrollOffset: number = 0,
) {
  if (rowLimit <= 0) {
    return [];
  }

  const rows = getHistoryRows(history);
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

export function getHistoryRows(history: HistoryEntry[]): HistoryRow[] {
  return [
    {
      text: WELCOME_TITLE,
      color: "cyan",
      bold: true,
    },
    {
      text: WELCOME_SUBTITLE,
      color: "gray",
    },
    { text: "" },
    ...history.flatMap((entry) => getHistoryEntryRows(entry)),
  ];
}

function getHistoryEntryRows(entry: HistoryEntry): HistoryRow[] {
  if (entry.type === "input") {
    return [
      {
        text: `$ ${entry.text}`,
        color: "green",
      },
      ...Array.from({ length: INPUT_HISTORY_MARGIN_BOTTOM }, () => ({ text: "" })),
    ];
  }

  if (entry.type === "system") {
    return splitPlainTextRows(entry.text, { color: "gray" });
  }

  if (isHelpOutput(entry.result)) {
    const output = getOutputSections(entry.result);
    return [
      {
        text: "Agent help",
        color: "cyan",
        bold: true,
      },
      ...splitPlainTextRows(getRenderedOutputText(output), { color: "cyan" }),
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

  if (entry.result.exitCode === 0) {
    return rows;
  }

  return [
    ...rows,
    {
      text: `exit code: ${entry.result.exitCode}`,
      color: "red",
    },
  ];
}

function splitPlainTextRows(
  text: string,
  style: Pick<HistoryRow, "color" | "bold"> = {},
): HistoryRow[] {
  return text.split("\n").map((line) => ({
    text: line,
    ...style,
  }));
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
