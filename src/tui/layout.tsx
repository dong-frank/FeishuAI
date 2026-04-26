import React from "react";
import { Box, Text } from "ink";

import { HistoryRowLine } from "./components.js";
import {
  COMPLETION_GHOST_STYLE,
  CURSOR_STYLE,
} from "./constants.js";
import type { HistoryRow } from "./history.js";

export { HISTORY_ROW_HEIGHT } from "./components.js";

type PromptLine = {
  beforeCursor: string;
  cursor: string;
  afterCursor: string;
  completionSuffix: string;
};

type AppLayoutProps = {
  sessionHeader: {
    cwd: string;
    gitSummary: string;
    larkSummary: string;
  };
  isRunning: boolean;
  historyViewportHeight: number;
  visibleHistoryRows: HistoryRow[];
  promptLine: PromptLine;
  statusPaneWidths: {
    left: number;
    right: number;
  };
  statusBar: {
    left: string;
    right: string;
  };
};

type SessionHeaderRowsInput = {
  sessionHeader: AppLayoutProps["sessionHeader"];
  isRunning: boolean;
};

type SessionHeaderRows = [
  {
    label: "cwd";
    text: string;
    status: "ready" | "running";
    brand: "git-helper";
  },
  {
    label: "git";
    text: string;
  },
  {
    label: "lark";
    text: string;
  },
];

export function getSessionHeaderRows({
  sessionHeader,
  isRunning,
}: SessionHeaderRowsInput): SessionHeaderRows {
  return [
    {
      label: "cwd",
      text: sessionHeader.cwd,
      status: isRunning ? "running" : "ready",
      brand: "git-helper",
    },
    {
      label: "git",
      text: stripStatusPrefix(sessionHeader.gitSummary, "git"),
    },
    {
      label: "lark",
      text: stripStatusPrefix(sessionHeader.larkSummary, "lark"),
    },
  ];
}

export function AppLayout({
  sessionHeader,
  isRunning,
  historyViewportHeight,
  visibleHistoryRows,
  promptLine,
  statusPaneWidths,
  statusBar,
}: AppLayoutProps) {
  const headerRows = getSessionHeaderRows({ sessionHeader, isRunning });
  const layoutHistoryRows = getLayoutHistoryRows(
    visibleHistoryRows,
    historyViewportHeight,
  );

  return (
    <Box
      flexDirection="column"
      overflow="hidden"
      paddingX={1}
      paddingY={1}
    >
      <Box borderStyle="double" borderColor="cyan" flexDirection="column" paddingX={1}>
        <Box borderStyle="single" flexDirection="column" paddingX={1} marginBottom={1}>
          <Box justifyContent="space-between">
            <Box>
              <Text>cwd: {headerRows[0].text}</Text>
              <Text color={isRunning ? "yellow" : "green"}>
                {" "}
                {headerRows[0].status}
              </Text>
            </Box>
            <Text color="cyan" bold>
              {headerRows[0].brand}
            </Text>
          </Box>
          <Box>
            <Text color="gray">git: {headerRows[1].text}</Text>
          </Box>
          <Box>
            <Text color="gray">lark: {headerRows[2].text}</Text>
          </Box>
        </Box>

        <Box
          flexDirection="column"
          height={historyViewportHeight}
          overflowY="hidden"
        >
          {layoutHistoryRows.map((row, index) => (
            <HistoryRowLine key={index} row={row} />
          ))}
        </Box>

        <Box borderStyle="single" borderColor="green" paddingX={1} marginTop={1}>
          <Text color="green">$ </Text>
          <Text>{promptLine.beforeCursor}</Text>
          <Text {...CURSOR_STYLE}>{promptLine.cursor}</Text>
          <Text>{promptLine.afterCursor}</Text>
          {promptLine.completionSuffix ? (
            <Text {...COMPLETION_GHOST_STYLE}>{promptLine.completionSuffix}</Text>
          ) : null}
        </Box>

        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Box width={statusPaneWidths.left}>
            <Text color="gray">{statusBar.left}</Text>
          </Box>
          {statusBar.right ? (
            <Box width={statusPaneWidths.right} justifyContent="flex-end">
              <Text color="yellow">{statusBar.right}</Text>
            </Box>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}

export function getLayoutHistoryRows(
  visibleHistoryRows: HistoryRow[],
  historyViewportHeight: number,
): HistoryRow[] {
  if (historyViewportHeight <= 0) {
    return [];
  }

  const rows = visibleHistoryRows.slice(0, historyViewportHeight);
  return [
    ...rows,
    ...Array.from(
      { length: Math.max(0, historyViewportHeight - rows.length) },
      () => ({ text: "" }),
    ),
  ];
}

function stripStatusPrefix(value: string, label: "git" | "lark") {
  const prefix = `${label}: `;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
