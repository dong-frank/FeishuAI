import React from "react";
import { Box, Text } from "ink";

import { HistoryRowLine } from "./components.js";
import {
  COMPLETION_GHOST_STYLE,
  CURSOR_STYLE,
} from "./constants.js";
import type { HistoryRow } from "./history.js";

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

export function AppLayout({
  sessionHeader,
  isRunning,
  historyViewportHeight,
  visibleHistoryRows,
  promptLine,
  statusPaneWidths,
  statusBar,
}: AppLayoutProps) {
  return (
    <Box
      flexDirection="column"
      overflow="hidden"
      paddingX={1}
      paddingY={1}
    >
      <Box borderStyle="double" borderColor="cyan" flexDirection="column" paddingX={1}>
        <Box borderStyle="single" paddingX={1} marginBottom={1}>
          <Text color="cyan" bold>
            git-helper
          </Text>
          <Text> cwd: {sessionHeader.cwd}</Text>
          <Text color="gray"> {sessionHeader.gitSummary}</Text>
          <Text color={isRunning ? "yellow" : "green"}>
            {" "}
            {isRunning ? "running" : "ready"}
          </Text>
        </Box>

        <Box
          flexDirection="column"
          height={historyViewportHeight}
          overflowY="hidden"
        >
          {visibleHistoryRows.map((row, index) => (
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
