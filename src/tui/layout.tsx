import React, { memo, useEffect, useState } from "react";
import { Box, Text } from "ink";

import { HistoryRowLine } from "./components.js";
import {
  COMPLETION_GHOST_STYLE,
  CURSOR_STYLE,
  TUI_STATUS_SCROLL_INTERVAL_MS,
  TUI_USAGE_TIP_INTERVAL_MS,
  TUI_USAGE_TIPS,
} from "./constants.js";
import type { HistoryRow } from "./history.js";
import { getStatusBarParts, getTerminalTextWidth, type AgentKind } from "./status.js";

export { HISTORY_ROW_HEIGHT } from "./components.js";

type PromptLine = {
  beforeCursor: string;
  cursor: string;
  afterCursor: string;
  completionSuffix: string;
};

type PromptDisplaySegment = {
  kind: "prompt" | "input" | "cursor" | "completion";
  text: string;
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
  promptViewportWidth?: number | undefined;
  statusPaneWidths: {
    left: number;
    right: number;
  };
  statusState: StatusState;
  viewportRows?: number | undefined;
};

type StatusState = {
  isRunning: boolean;
  isAgentWaiting: boolean;
  isAgentReviewing: boolean;
  agentKind?: AgentKind | undefined;
  agentCommand?: string | undefined;
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
  promptViewportWidth,
  statusPaneWidths,
  statusState,
  viewportRows,
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
      {...(viewportRows ? { height: viewportRows } : {})}
    >
      <Box flexDirection="column">
        <Box borderStyle="single" flexDirection="column" paddingX={1}>
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

        <HistoryPanel
          rows={layoutHistoryRows}
          height={historyViewportHeight}
        />

        <PromptPanel promptLine={promptLine} width={promptViewportWidth} />

        <StatusBar statusState={statusState} statusPaneWidths={statusPaneWidths} />
      </Box>
    </Box>
  );
}

const HistoryPanel = memo(function HistoryPanel({
  rows,
  height,
}: {
  rows: HistoryRow[];
  height: number;
}) {
  return (
    <Box borderStyle="single" flexDirection="column" height={height + 2} overflowY="hidden">
      {rows.map((row, index) => (
        <HistoryRowLine key={index} row={row} />
      ))}
    </Box>
  );
});

function PromptPanel({
  promptLine,
  width,
}: {
  promptLine: PromptLine;
  width?: number | undefined;
}) {
  const rows = getPromptDisplayRows(promptLine, width);
  return (
    <Box borderStyle="single" borderColor="green" flexDirection="column" paddingX={1}>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex}>
          {row.map((segment, segmentIndex) => (
            <PromptSegmentText key={segmentIndex} segment={segment} />
          ))}
        </Box>
      ))}
    </Box>
  );
}

function PromptSegmentText({ segment }: { segment: PromptDisplaySegment }) {
  if (segment.kind === "prompt") {
    return <Text color="green">{segment.text}</Text>;
  }

  if (segment.kind === "cursor") {
    return <Text {...CURSOR_STYLE}>{segment.text}</Text>;
  }

  if (segment.kind === "completion") {
    return <Text {...COMPLETION_GHOST_STYLE}>{segment.text}</Text>;
  }

  return <Text>{segment.text}</Text>;
}

function StatusBar({
  statusState,
  statusPaneWidths,
}: {
  statusState: StatusState;
  statusPaneWidths: AppLayoutProps["statusPaneWidths"];
}) {
  const [tipIndex, setTipIndex] = useState(0);
  const [tipStatusScrollOffset, setTipStatusScrollOffset] = useState(0);
  const [agentStatusScrollOffset, setAgentStatusScrollOffset] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex((current) => (current + 1) % TUI_USAGE_TIPS.length);
    }, TUI_USAGE_TIP_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setTipStatusScrollOffset(0);
  }, [tipIndex]);

  useEffect(() => {
    setAgentStatusScrollOffset(0);
  }, [
    statusState.isRunning,
    statusState.isAgentWaiting,
    statusState.isAgentReviewing,
    statusState.agentKind,
    statusState.agentCommand,
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTipStatusScrollOffset((current) => current + 1);
      setAgentStatusScrollOffset((current) => current + 1);
    }, TUI_STATUS_SCROLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const statusBar = getStatusBarParts({
    ...statusState,
    tipIndex,
    tipStatusWidth: statusPaneWidths.left,
    tipStatusScrollOffset,
    agentStatusWidth: statusPaneWidths.right,
    agentStatusScrollOffset,
  });

  return (
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
  );
}

export function getPromptViewportWidth(columns: number | undefined) {
  if (!columns) {
    return undefined;
  }

  return Math.max(8, columns - 6);
}

export function getPromptDisplayRows(
  promptLine: PromptLine,
  width?: number | undefined,
): PromptDisplaySegment[][] {
  const allSegments: PromptDisplaySegment[] = [
    { kind: "prompt", text: "$ " },
    { kind: "input", text: promptLine.beforeCursor },
    { kind: "cursor", text: promptLine.cursor },
    { kind: "input", text: promptLine.afterCursor },
    { kind: "completion", text: promptLine.completionSuffix },
  ];
  const segments = allSegments.filter((segment) => segment.text.length > 0);

  if (!width || width <= 0) {
    return [segments];
  }

  const rows: PromptDisplaySegment[][] = [[]];
  let currentWidth = 0;

  for (const segment of segments) {
    for (const character of Array.from(segment.text)) {
      const characterWidth = getTerminalTextWidth(character);
      if (rows[rows.length - 1]!.length > 0 && currentWidth + characterWidth > width) {
        rows.push([]);
        currentWidth = 0;
      }

      pushPromptSegment(rows[rows.length - 1]!, {
        kind: segment.kind,
        text: character,
      });
      currentWidth += characterWidth;
    }
  }

  return rows;
}

function pushPromptSegment(row: PromptDisplaySegment[], segment: PromptDisplaySegment) {
  const previous = row[row.length - 1];
  if (previous?.kind === segment.kind) {
    previous.text += segment.text;
    return;
  }

  row.push(segment);
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
