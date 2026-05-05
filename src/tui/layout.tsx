import React, { memo } from "react";
import { Box, Text } from "ink";

import { HistoryRowLine } from "./components.js";
import {
  COMPLETION_GHOST_STYLE,
  CURSOR_STYLE,
} from "./constants.js";
import type { HistoryRow } from "./history.js";
import { getStatusBarParts, getTerminalTextWidth, type AgentKind } from "./status.js";
import type { TuiSessionHeaderChip } from "../runtime/tui-session.js";

export { HISTORY_ROW_HEIGHT } from "./components.js";

type PromptLine = {
  promptPrefix?: string | undefined;
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
    display: {
      cwd: string;
      git: TuiSessionHeaderChip[];
      lark: TuiSessionHeaderChip[];
    };
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
    label: "brand";
    brand: "GITX";
  },
  {
    label: "git";
    git: TuiSessionHeaderChip[];
  },
  {
    label: "lark";
    lark: TuiSessionHeaderChip[];
  },
];

export function getSessionHeaderRows({
  sessionHeader,
}: SessionHeaderRowsInput): SessionHeaderRows {
  return [
    {
      label: "brand",
      brand: "GITX",
    },
    {
      label: "git",
      git: sessionHeader.display.git,
    },
    {
      label: "lark",
      lark: sessionHeader.display.lark,
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
          <Box justifyContent="flex-end">
            <Text color="yellow" bold>
              {headerRows[0].brand}
            </Text>
          </Box>
          <Box>
            <HeaderLabel text="Linus" />
            <HeaderChipList chips={headerRows[1].git} />
          </Box>
          <Box>
            <HeaderLabel text="Friday" />
            <HeaderChipList chips={headerRows[2].lark} />
          </Box>
        </Box>

        <HistoryPanel
          rows={layoutHistoryRows}
          height={historyViewportHeight}
        />

        <PromptPanel
          promptLine={{
            ...promptLine,
            promptPrefix: sessionHeader.display.cwd,
          }}
          width={promptViewportWidth}
        />

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

function HeaderLabel({ text }: { text: string }) {
  return <Text color="gray">{formatHeaderLabelText(text)}</Text>;
}

const HEADER_LABEL_WIDTH = 6;

export function formatHeaderLabelText(text: string) {
  return `${padTerminalTextEnd(text, HEADER_LABEL_WIDTH)}│ `;
}

function padTerminalTextEnd(text: string, width: number) {
  const paddingWidth = Math.max(0, width - getTerminalTextWidth(text));
  return `${text}${" ".repeat(paddingWidth)}`;
}

function HeaderChipList({ chips }: { chips: TuiSessionHeaderChip[] }) {
  return (
    <>
      {chips.map((chip, index) => (
        <React.Fragment key={`${chip.text}-${index}`}>
          {index > 0 ? <Text> </Text> : null}
          <HeaderChip chip={chip} />
        </React.Fragment>
      ))}
    </>
  );
}

function HeaderChip({ chip }: { chip: TuiSessionHeaderChip }) {
  return <Text color={getHeaderChipColor(chip.tone)}>[{chip.text}]</Text>;
}

export function getHeaderChipColor(tone: TuiSessionHeaderChip["tone"]) {
  if (tone === "primary") {
    return "green";
  }
  if (tone === "info") {
    return "blue";
  }
  if (tone === "warning") {
    return "yellow";
  }
  if (tone === "success") {
    return "green";
  }

  return "gray";
}

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
  statusPaneWidths,
}: {
  statusState: StatusState;
  statusPaneWidths: AppLayoutProps["statusPaneWidths"];
}) {
  const statusBar = getStatusBarParts({
    isRunning: false,
    isAgentWaiting: false,
    tipStatusWidth: statusPaneWidths.left,
  });

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Box width={statusPaneWidths.left}>
        <Text color="gray">{statusBar.left}</Text>
      </Box>
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
    { kind: "prompt", text: `${promptLine.promptPrefix ?? ""}${
      promptLine.promptPrefix ? " " : ""
    }❯ ` },
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
