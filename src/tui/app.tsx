import { stripVTControlCharacters } from "node:util";

import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";

import type { CommandContext } from "../agent/types.js";
import { createCommandAgent } from "../agent/command-agent.js";
import { classifyCommand } from "../runtime/command-registry.js";
import { getCompletion } from "../runtime/completion.js";
import {
  parseCommandLine,
  runCommandLine,
  type CommandRunOutput,
} from "../runtime/command-runner.js";
import { getGitCommandStats } from "../runtime/git-command-stats.js";
import {
  formatTuiSessionGitSummary,
  initializeTuiSession,
  type TuiSessionInfo,
} from "../runtime/tui-session.js";

export type HistoryEntry =
  | {
      type: "input";
      text: string;
    }
  | {
      type: "output";
      result: CommandRunOutput;
    }
  | {
      type: "system";
      text: string;
    };

export const BEFORE_RUN_IDLE_MS = 5000;
export const BEFORE_RUN_SUCCESS_SKIP_THRESHOLD = 3;
export const DEFAULT_STATUS_TEXT = "Enter runs command. Tab completes. Ctrl+C exits.";
export const WELCOME_TITLE = "Welcome to git-helper TUI";
export const WELCOME_SUBTITLE = "Type a command, or type exit to quit.";
export const INPUT_HISTORY_MARGIN_BOTTOM = 1;
export const DEFAULT_HISTORY_VIEWPORT_HEIGHT = 14;
export const MIN_HISTORY_VIEWPORT_HEIGHT = 1;
export const RESERVED_TUI_CHROME_ROWS = 15;
export const WELCOME_BANNER_ROWS = 3;

export const COMPLETION_GHOST_STYLE = {
  color: "black",
  dimColor: true,
} as const;

export const CURSOR_STYLE = {
  inverse: true,
} as const;

export function getPromptLineParts({
  input,
  cursorIndex,
  completionSuffix = "",
}: {
  input: string;
  cursorIndex: number;
  completionSuffix?: string | undefined;
}) {
  const safeCursorIndex = Math.min(Math.max(cursorIndex, 0), input.length);
  const beforeCursor = input.slice(0, safeCursorIndex);
  const cursor = input.at(safeCursorIndex) ?? completionSuffix.at(0) ?? " ";
  const afterCursor = input.slice(safeCursorIndex + (safeCursorIndex < input.length ? 1 : 0));
  const visibleCompletionSuffix =
    safeCursorIndex >= input.length ? completionSuffix.slice(1) : "";

  return {
    beforeCursor,
    cursor,
    completionSuffix: visibleCompletionSuffix,
    afterCursor,
  };
}

export type EditableInput = {
  input: string;
  cursorIndex: number;
};

type EditableInputAction =
  | "left"
  | "right"
  | "backspace"
  | "delete"
  | {
      type: "insert";
      text: string;
    }
  | {
      type: "replace";
      text: string;
    };

export function getNextEditableInput(
  state: EditableInput,
  action: EditableInputAction,
): EditableInput {
  const cursorIndex = Math.min(Math.max(state.cursorIndex, 0), state.input.length);
  if (action === "left") {
    return {
      input: state.input,
      cursorIndex: Math.max(0, cursorIndex - 1),
    };
  }

  if (action === "right") {
    return {
      input: state.input,
      cursorIndex: Math.min(state.input.length, cursorIndex + 1),
    };
  }

  if (action === "backspace") {
    if (cursorIndex === 0) {
      return { input: state.input, cursorIndex };
    }

    return {
      input: `${state.input.slice(0, cursorIndex - 1)}${state.input.slice(cursorIndex)}`,
      cursorIndex: cursorIndex - 1,
    };
  }

  if (action === "delete") {
    if (cursorIndex >= state.input.length) {
      return { input: state.input, cursorIndex };
    }

    return {
      input: `${state.input.slice(0, cursorIndex)}${state.input.slice(cursorIndex + 1)}`,
      cursorIndex,
    };
  }

  if (action.type === "replace") {
    return {
      input: action.text,
      cursorIndex: action.text.length,
    };
  }

  return {
    input: `${state.input.slice(0, cursorIndex)}${action.text}${state.input.slice(cursorIndex)}`,
    cursorIndex: cursorIndex + action.text.length,
  };
}

export function sanitizeTuiText(text: string) {
  return stripVTControlCharacters(
    text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

type OutputSection = {
  label: "help" | "output";
  body: string;
};

type OutputTextPart = {
  text: string;
  color?: "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray";
  bold?: boolean;
};

export type HistoryRow = {
  text: string;
  parts?: OutputTextPart[] | undefined;
  color?: "red" | "green" | "yellow" | "cyan" | "gray" | undefined;
  bold?: boolean | undefined;
};

const SGR_COLOR_BY_CODE = new Map<number, NonNullable<OutputTextPart["color"]>>([
  [30, "gray"],
  [31, "red"],
  [32, "green"],
  [33, "yellow"],
  [34, "blue"],
  [35, "magenta"],
  [36, "cyan"],
  [37, "white"],
  [90, "gray"],
  [91, "red"],
  [92, "green"],
  [93, "yellow"],
  [94, "blue"],
  [95, "magenta"],
  [96, "cyan"],
  [97, "white"],
]);

export function getOutputSections(entry: CommandRunOutput): OutputSection {
  if (entry.kind === "help") {
    return {
      label: "help",
      body: sanitizeTuiText(entry.help),
    };
  }

  return {
    label: "output",
    body: [entry.stdout, entry.stderr]
      .filter(Boolean)
      .map((text) => sanitizeTuiText(text))
      .join(""),
  };
}

function normalizeTuiText(text: string) {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ");
}

export function parseAnsiTextParts(text: string): OutputTextPart[] {
  const safeText = normalizeTuiText(text)
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[(?![0-9;]*m)[0-?]*[ -/]*[@-~]/g, "");
  const parts: OutputTextPart[] = [];
  let color: OutputTextPart["color"];
  let bold = false;
  let lastIndex = 0;
  const sgrPattern = /\x1B\[([0-9;]*)m/g;

  function pushText(value: string) {
    if (!value) {
      return;
    }

    parts.push({
      text: value,
      ...(color ? { color } : {}),
      ...(bold ? { bold } : {}),
    });
  }

  for (const match of safeText.matchAll(sgrPattern)) {
    pushText(safeText.slice(lastIndex, match.index));
    const codes = (match[1] || "0").split(";").map((code) => Number(code || "0"));
    for (const code of codes) {
      if (code === 0) {
        color = undefined;
        bold = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (code === 39) {
        color = undefined;
      } else if (SGR_COLOR_BY_CODE.has(code)) {
        color = SGR_COLOR_BY_CODE.get(code);
      }
    }
    lastIndex = match.index + match[0].length;
  }

  pushText(safeText.slice(lastIndex));
  return parts;
}

export function getOutputTextParts(entry: CommandRunOutput): OutputTextPart[] {
  if (entry.kind === "help") {
    return parseAnsiTextParts(entry.help);
  }

  return [entry.stdout, entry.stderr]
    .filter(Boolean)
    .flatMap((text) => parseAnsiTextParts(text));
}

export function shouldShowClassificationLine() {
  return false;
}

export function getRenderedOutputText(output: OutputSection) {
  return output.body.trimEnd();
}

export function isHelpOutput(result: CommandRunOutput) {
  return result.kind === "help";
}

export function getStatusLine({
  isRunning,
  isAgentWaiting,
  isAgentReviewing = false,
  agentCommand,
  isBeforeRunPending = false,
  pendingCommand,
}: {
  isRunning: boolean;
  isAgentWaiting: boolean;
  isAgentReviewing?: boolean | undefined;
  agentCommand?: string | undefined;
  isBeforeRunPending?: boolean | undefined;
  pendingCommand?: string | undefined;
}) {
  if (isAgentWaiting) {
    return `agent: asking help for ${agentCommand ?? "command"} ...`;
  }

  if (isAgentReviewing) {
    return `agent: reviewing ${agentCommand ?? "command"} ...`;
  }

  if (isRunning) {
    return "command: running ...";
  }

  if (isBeforeRunPending) {
    return `agent: standing by for ${pendingCommand ?? "command"}`;
  }

  return DEFAULT_STATUS_TEXT;
}

export function shouldScheduleBeforeRun({
  input,
  completionSuffix,
  isRunning,
}: {
  input: string;
  completionSuffix?: string | undefined;
  isRunning: boolean;
}) {
  const parsed = parseCommandLine(input);
  const classification = parsed ? classifyCommand(parsed) : undefined;
  return Boolean(
    parsed &&
      !parsed.helpRequested &&
      !completionSuffix &&
      !isRunning &&
      classification?.kind === "git" &&
      input.trim().length > 0,
  );
}

export function buildBeforeRunContext(
  input: string,
  cwd: string = process.cwd(),
): Promise<CommandContext | undefined> {
  const parsed = parseCommandLine(input);
  const classification = parsed ? classifyCommand(parsed) : undefined;
  if (!parsed || parsed.helpRequested || classification?.kind !== "git") {
    return Promise.resolve(undefined);
  }

  const rawCommand = [parsed.command, ...parsed.args].join(" ");
  return getGitCommandStats(cwd, rawCommand).then((stats) => ({
    cwd,
    command: parsed.command,
    args: parsed.args,
    rawCommand,
    gitStats: {
      successCount: stats?.successCount ?? 0,
      failures: stats?.failures ?? [],
    },
  }));
}

export function shouldTriggerBeforeRunForContext(context: CommandContext) {
  return (
    (context.gitStats?.successCount ?? 0) < BEFORE_RUN_SUCCESS_SKIP_THRESHOLD
  );
}

export function getSessionHeaderParts(session: TuiSessionInfo | undefined) {
  return {
    cwd: session?.cwd ?? process.cwd(),
    gitSummary: session ? formatTuiSessionGitSummary(session.git) : "git: initializing",
  };
}

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

export function shouldRefreshSessionAfterCommand(result: CommandRunOutput) {
  return result.kind === "execute" && result.classification?.kind === "git";
}

type HistoryScrollAction = "lineUp" | "lineDown" | "pageUp" | "pageDown";

export function getNextHistoryScrollOffset(
  currentOffset: number,
  action: HistoryScrollAction,
  totalRows: number,
  viewportRows: number,
) {
  const maxOffset = Math.max(0, totalRows - viewportRows);
  const pageSize = Math.max(1, viewportRows);
  const deltaByAction: Record<HistoryScrollAction, number> = {
    lineUp: 1,
    lineDown: -1,
    pageUp: pageSize,
    pageDown: -pageSize,
  };
  const nextOffset = currentOffset + deltaByAction[action];
  return Math.min(maxOffset, Math.max(0, nextOffset));
}

export function getHistoryRows(history: HistoryEntry[]): HistoryRow[] {
  return history.flatMap((entry) => getHistoryEntryRows(entry));
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

  const outputRows = splitOutputPartsIntoRows(getOutputTextParts(entry.result));
  if (entry.result.exitCode === 0) {
    return outputRows;
  }

  return [
    ...outputRows,
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

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [session, setSession] = useState<TuiSessionInfo | undefined>();
  const [input, setInput] = useState("");
  const [cursorIndex, setCursorIndex] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isAgentWaiting, setIsAgentWaiting] = useState(false);
  const [isAgentReviewing, setIsAgentReviewing] = useState(false);
  const [agentStatusCommand, setAgentStatusCommand] = useState<string | undefined>();
  const [pendingBeforeRunCommand, setPendingBeforeRunCommand] = useState<
    string | undefined
  >();
  const lastBeforeRunCommand = useRef<string | undefined>(undefined);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyScrollOffset, setHistoryScrollOffset] = useState(0);
  const completion = getCompletion(input);
  const promptLine = getPromptLineParts({
    input,
    cursorIndex,
    completionSuffix: completion?.suffix,
  });
  const statusLine = getStatusLine({
    isRunning,
    isAgentWaiting,
    isAgentReviewing,
    agentCommand: agentStatusCommand,
    isBeforeRunPending: Boolean(pendingBeforeRunCommand),
    pendingCommand: pendingBeforeRunCommand,
  });
  const sessionHeader = getSessionHeaderParts(session);
  const historyViewportHeight = getHistoryViewportHeight(stdout.rows);
  const historyRows = getHistoryRows(history);
  const historyRowLimit = Math.max(0, historyViewportHeight - WELCOME_BANNER_ROWS);
  const visibleHistoryRows = getVisibleHistoryRows(
    history,
    historyRowLimit,
    historyScrollOffset,
  );

  useEffect(() => {
    let cancelled = false;
    void refreshSession(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshSession(isCancelled: () => boolean = () => false) {
    try {
      const nextSession = await initializeTuiSession();
      if (!isCancelled()) {
        setSession(nextSession);
      }
    } catch {
      // Session information is auxiliary; command interaction should keep working.
    }
  }

  useEffect(() => {
    if (
      !shouldScheduleBeforeRun({
        input,
        completionSuffix: completion?.suffix,
        isRunning,
      })
    ) {
      return;
    }

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    void buildBeforeRunContext(input).then((context) => {
      if (
        cancelled ||
        !context ||
        !shouldTriggerBeforeRunForContext(context) ||
        lastBeforeRunCommand.current === context.rawCommand
      ) {
        return;
      }

      setPendingBeforeRunCommand(context.rawCommand);
      timeout = setTimeout(() => {
        setPendingBeforeRunCommand(undefined);
        lastBeforeRunCommand.current = context.rawCommand;
        void triggerBeforeRun(context);
      }, BEFORE_RUN_IDLE_MS);
    });

    return () => {
      cancelled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      setPendingBeforeRunCommand(undefined);
    };
  }, [completion?.suffix, input, isRunning]);

  useInput((character, key) => {
    if (key.ctrl && character === "c") {
      exit();
      return;
    }

    if (isRunning) {
      return;
    }

    if (key.pageUp) {
      scrollHistory("pageUp");
      return;
    }

    if (key.pageDown) {
      scrollHistory("pageDown");
      return;
    }

    if (key.upArrow) {
      scrollHistory("lineUp");
      return;
    }

    if (key.downArrow) {
      scrollHistory("lineDown");
      return;
    }

    if (key.return) {
      void submitInput();
      return;
    }

    if (key.tab && completion) {
      const next = getNextEditableInput(
        { input, cursorIndex },
        { type: "replace", text: completion.completion },
      );
      setInput(next.input);
      setCursorIndex(next.cursorIndex);
      return;
    }

    if (key.leftArrow) {
      const next = getNextEditableInput({ input, cursorIndex }, "left");
      setCursorIndex(next.cursorIndex);
      return;
    }

    if (key.rightArrow) {
      const next = getNextEditableInput({ input, cursorIndex }, "right");
      setCursorIndex(next.cursorIndex);
      return;
    }

    if (key.backspace) {
      const next = getNextEditableInput({ input, cursorIndex }, "backspace");
      setInput(next.input);
      setCursorIndex(next.cursorIndex);
      return;
    }

    if (key.delete) {
      const next = getNextEditableInput({ input, cursorIndex }, "delete");
      setInput(next.input);
      setCursorIndex(next.cursorIndex);
      return;
    }

    if (character) {
      const next = getNextEditableInput(
        { input, cursorIndex },
        { type: "insert", text: character },
      );
      setInput(next.input);
      setCursorIndex(next.cursorIndex);
    }
  });

  async function triggerBeforeRun(context: CommandContext) {
    setIsAgentWaiting(true);
    setAgentStatusCommand(context.rawCommand);
    try {
      const message = await createCommandAgent().beforeRun?.(context);
      if (!message) {
        return;
      }

      const parsed = parseCommandLine(context.rawCommand);
      const classification = parsed ? classifyCommand(parsed) : undefined;
      const entry: HistoryEntry = {
        type: "output",
        result: {
          commandLine: context.rawCommand,
          kind: "help",
          ...(classification ? { classification } : {}),
          exitCode: 0,
          stdout: "",
          stderr: "",
          help: message,
        },
      };
      setHistory((current) => [...current, entry].slice(-20));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const entry: HistoryEntry = { type: "system", text: message };
      setHistory((current) => [...current, entry].slice(-20));
    } finally {
      setIsAgentWaiting(false);
      setAgentStatusCommand(undefined);
    }
  }

  async function triggerAfterSuccessReview(
    result: CommandRunOutput & { kind: "execute"; afterSuccess: Promise<string | void> },
  ) {
    setIsAgentReviewing(true);
    setAgentStatusCommand(result.commandLine);
    try {
      const message = await result.afterSuccess;
      if (!message) {
        return;
      }

      const entry: HistoryEntry = {
        type: "output",
        result: {
          commandLine: result.commandLine,
          kind: "help",
          ...(result.classification ? { classification: result.classification } : {}),
          exitCode: 0,
          stdout: "",
          stderr: "",
          help: message,
        },
      };
      setHistory((current) => [...current, entry].slice(-20));
      setHistoryScrollOffset(0);
    } catch {
      // afterSuccess is advisory and should never disturb command output.
    } finally {
      setIsAgentReviewing(false);
      setAgentStatusCommand(undefined);
    }
  }

  async function submitInput() {
    const commandLine = input.trim();
    if (!commandLine) {
      return;
    }

    setInput("");
    setCursorIndex(0);
    setHistory((current) => [...current, { type: "input", text: commandLine }]);
    setHistoryScrollOffset(0);

    if (commandLine === "exit" || commandLine === "quit") {
      exit();
      return;
    }

    setIsRunning(true);
    const parsed = parseCommandLine(commandLine);
    const isHelpRequest = Boolean(parsed?.helpRequested);
    if (isHelpRequest && parsed) {
      setIsAgentWaiting(true);
      setAgentStatusCommand([parsed.command, ...parsed.args].join(" "));
    }
    try {
      const result = await runCommandLine(commandLine, {
        agent: createCommandAgent(),
      });
      const entry: HistoryEntry = { type: "output", result };
      setHistory((current) => [...current, entry].slice(-20));
      setHistoryScrollOffset(0);
      if (shouldRefreshSessionAfterCommand(result)) {
        void refreshSession();
      }
      if (hasAfterSuccessReview(result)) {
        void triggerAfterSuccessReview(result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const entry: HistoryEntry = { type: "system", text: message };
      setHistory((current) => [...current, entry].slice(-20));
      setHistoryScrollOffset(0);
    } finally {
      setIsRunning(false);
      if (isHelpRequest) {
        setIsAgentWaiting(false);
        setAgentStatusCommand(undefined);
      }
    }
  }

  function scrollHistory(action: HistoryScrollAction) {
    setHistoryScrollOffset((current) =>
      getNextHistoryScrollOffset(current, action, historyRows.length, historyRowLimit),
    );
  }

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
          <WelcomeBanner />
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
          <Text color={isAgentWaiting || isAgentReviewing || isRunning ? "yellow" : "gray"}>
            {statusLine}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function hasAfterSuccessReview(
  result: CommandRunOutput,
): result is CommandRunOutput & {
  kind: "execute";
  afterSuccess: Promise<string | void>;
} {
  return result.kind === "execute" && Boolean(result.afterSuccess);
}

function WelcomeBanner() {
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
    >
      <Text color="cyan" bold>
        {WELCOME_TITLE}
      </Text>
      <Text color="gray">{WELCOME_SUBTITLE}</Text>
    </Box>
  );
}

function HistoryRowLine({ row }: { row: HistoryRow }) {
  const style = {
    ...(row.color ? { color: row.color } : {}),
    ...(row.bold ? { bold: true } : {}),
  };
  return (
    <Text {...style}>
      {row.parts
        ? row.parts.map((part, index) => <OutputPartText key={index} part={part} />)
        : row.text}
    </Text>
  );
}

function OutputPartText({ part }: { part: OutputTextPart }) {
  const style = {
    ...(part.color ? { color: part.color } : {}),
    ...(part.bold ? { bold: true } : {}),
  };

  return <Text {...style}>{part.text}</Text>;
}
