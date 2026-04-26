import React, { useEffect, useRef, useState } from "react";
import { useApp, useInput, useStdout } from "ink";

import type { CommandContext } from "../agent/types.js";
import { createCommandAgent } from "../agent/command-agent.js";
import { createLarkAgent } from "../agent/lark-agent.js";
import { classifyCommand } from "../runtime/command-registry.js";
import {
  buildCommitMessageContext,
  quoteCommitMessageForShell,
} from "../runtime/commit-message-context.js";
import { getCompletion } from "../runtime/completion.js";
import {
  parseCommandLine,
  runCommandLine,
  type CommandOutputChunk,
  type CommandRunOutput,
} from "../runtime/command-runner.js";
import {
  initializeTuiSession,
  type TuiSessionInfo,
} from "../runtime/tui-session.js";
import { AppLayout } from "./layout.js";
import {
  BEFORE_RUN_IDLE_MS,
  COMMIT_MESSAGE_IDLE_MS,
  TUI_STATUS_SCROLL_INTERVAL_MS,
  TUI_USAGE_TIP_INTERVAL_MS,
  TUI_USAGE_TIPS,
} from "./constants.js";
import {
  getHistoryRows,
  getHistoryViewportHeight,
  getNextHistoryScrollOffset,
  getVisibleHistoryRows,
  type HistoryEntry,
  type HistoryScrollAction,
} from "./history.js";
import { getNextEditableInput, getPromptLineParts } from "./input.js";
import {
  buildBeforeRunContext,
  getSessionHeaderParts,
  shouldRefreshSessionAfterCommand,
  shouldScheduleBeforeRun,
  shouldScheduleCommitMessageGeneration,
  shouldTriggerBeforeRunForContext,
} from "./runtime.js";
import { getStatusBarParts, getStatusPaneWidths, type AgentKind } from "./status.js";

export * from "./constants.js";
export * from "./history.js";
export * from "./input.js";
export * from "./output.js";
export * from "./runtime.js";
export * from "./status.js";

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [session, setSession] = useState<TuiSessionInfo | undefined>();
  const [input, setInput] = useState("");
  const [cursorIndex, setCursorIndex] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isAgentWaiting, setIsAgentWaiting] = useState(false);
  const [isCommitMessageGenerating, setIsCommitMessageGenerating] = useState(false);
  const [isAgentReviewing, setIsAgentReviewing] = useState(false);
  const [activeAgentKind, setActiveAgentKind] = useState<AgentKind | undefined>();
  const [agentStatusCommand, setAgentStatusCommand] = useState<string | undefined>();
  const [pendingBeforeRunCommand, setPendingBeforeRunCommand] = useState<
    string | undefined
  >();
  const lastBeforeRunCommand = useRef<string | undefined>(undefined);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyScrollOffset, setHistoryScrollOffset] = useState(0);
  const [usageTipIndex, setUsageTipIndex] = useState(0);
  const [tipStatusScrollOffset, setTipStatusScrollOffset] = useState(0);
  const [agentStatusScrollOffset, setAgentStatusScrollOffset] = useState(0);
  const completion = getCompletion(input);
  const promptLine = getPromptLineParts({
    input,
    cursorIndex,
    completionSuffix: completion?.suffix,
  });
  const statusPaneWidths = getStatusPaneWidths(stdout.columns);
  const statusBar = getStatusBarParts({
    isRunning,
    isAgentWaiting,
    isCommitMessageGenerating,
    isAgentReviewing,
    agentKind: activeAgentKind,
    agentCommand: agentStatusCommand,
    isBeforeRunPending: Boolean(pendingBeforeRunCommand),
    pendingCommand: pendingBeforeRunCommand,
    tipIndex: usageTipIndex,
    tipStatusWidth: statusPaneWidths.left,
    tipStatusScrollOffset,
    agentStatusWidth: statusPaneWidths.right,
    agentStatusScrollOffset,
  });
  const sessionHeader = getSessionHeaderParts(session);
  const historyViewportHeight = getHistoryViewportHeight(stdout.rows);
  const historyRows = getHistoryRows(history);
  const historyRowLimit = historyViewportHeight;
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

  useEffect(() => {
    const interval = setInterval(() => {
      setUsageTipIndex((current) => (current + 1) % TUI_USAGE_TIPS.length);
    }, TUI_USAGE_TIP_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setTipStatusScrollOffset(0);
  }, [usageTipIndex]);

  useEffect(() => {
    setAgentStatusScrollOffset(0);
  }, [
    isRunning,
    isAgentWaiting,
    isCommitMessageGenerating,
    isAgentReviewing,
    activeAgentKind,
    agentStatusCommand,
    pendingBeforeRunCommand,
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
      shouldScheduleCommitMessageGeneration({
        input,
        completionSuffix: completion?.suffix,
        isRunning,
      })
    ) {
      let cancelled = false;
      const commandLine = input.trim();
      setPendingBeforeRunCommand(commandLine);
      const timeout = setTimeout(() => {
        setPendingBeforeRunCommand(undefined);
        void triggerCommitMessageGeneration(commandLine, () => cancelled);
      }, COMMIT_MESSAGE_IDLE_MS);

      return () => {
        cancelled = true;
        clearTimeout(timeout);
        setPendingBeforeRunCommand(undefined);
      };
    }

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

    if (isRunning) {
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
    setActiveAgentKind("command");
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
      setHistoryScrollOffset(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const entry: HistoryEntry = { type: "system", text: message };
      setHistory((current) => [...current, entry].slice(-20));
      setHistoryScrollOffset(0);
    } finally {
      setIsAgentWaiting(false);
      setActiveAgentKind(undefined);
      setAgentStatusCommand(undefined);
    }
  }

  async function triggerCommitMessageGeneration(
    commandLine: string,
    isCancelled: () => boolean = () => false,
  ) {
    setIsAgentWaiting(true);
    setIsCommitMessageGenerating(true);
    setActiveAgentKind("command");
    setAgentStatusCommand(commandLine);
    try {
      const context = await buildCommitMessageContext();
      if (isCancelled()) {
        return;
      }

      const message = await createCommandAgent().generateCommitMessage?.(context);
      if (isCancelled() || !message) {
        return;
      }

      const normalizedMessage = message.trim().replace(/^["']|["']$/g, "");
      const nextInput = `${commandLine} ${quoteCommitMessageForShell(normalizedMessage)}`;
      setInput(nextInput);
      setCursorIndex(nextInput.length);
      const entry: HistoryEntry = {
        type: "output",
        result: {
          commandLine,
          kind: "help",
          classification: { kind: "git", subcommand: "commit" },
          exitCode: 0,
          stdout: "",
          stderr: "",
          help: normalizedMessage,
        },
      };
      setHistory((current) => [...current, entry].slice(-20));
      setHistoryScrollOffset(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const entry: HistoryEntry = { type: "system", text: message };
      setHistory((current) => [...current, entry].slice(-20));
      setHistoryScrollOffset(0);
    } finally {
      setIsCommitMessageGenerating(false);
      setIsAgentWaiting(false);
      setActiveAgentKind(undefined);
      setAgentStatusCommand(undefined);
    }
  }

  async function triggerAfterSuccessReview(
    result: CommandRunOutput & {
      kind: "execute";
      afterSuccess: Promise<string | void>;
      afterSuccessAgentKind?: "command" | "lark";
    },
  ) {
    setIsAgentReviewing(true);
    setActiveAgentKind(result.afterSuccessAgentKind ?? "command");
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
      setActiveAgentKind(undefined);
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
      setActiveAgentKind("command");
      setAgentStatusCommand([parsed.command, ...parsed.args].join(" "));
    }
    const classification = parsed ? classifyCommand(parsed) : undefined;
    let liveStdout = "";
    let liveStderr = "";
    let hasLiveOutput = false;

    function updateLiveOutput(chunk: CommandOutputChunk, source: "user" | "agent" = "user") {
      if (chunk.stream === "stdout") {
        liveStdout += chunk.text;
      } else {
        liveStderr += chunk.text;
      }

      const shouldReplaceLiveEntry = hasLiveOutput;
      hasLiveOutput = true;
      const entry: HistoryEntry = {
        type: "output",
        ...(source === "agent" ? { source } : {}),
        result: {
          commandLine,
          kind: "execute",
          ...(classification ? { classification } : {}),
          exitCode: 0,
          stdout: liveStdout,
          stderr: liveStderr,
        },
      };
      setHistory((current) => {
        const lastEntry = current.at(-1);
        const canReplace =
          shouldReplaceLiveEntry &&
          lastEntry?.type === "output" &&
          lastEntry.source === entry.source &&
          lastEntry.result.commandLine === commandLine;
        return [...(canReplace ? current.slice(0, -1) : current), entry].slice(-20);
      });
      setHistoryScrollOffset(0);
    }

    const updateUserLiveOutput = (chunk: CommandOutputChunk) => updateLiveOutput(chunk, "user");
    const updateAgentLiveOutput = (chunk: CommandOutputChunk) => updateLiveOutput(chunk, "agent");

    try {
      const result = await runCommandLine(commandLine, {
        agent: createCommandAgent(),
        larkAgent: createLarkAgent({
          onLarkCliOutput: updateAgentLiveOutput,
        }),
        onOutput: updateUserLiveOutput,
      });
      const entry: HistoryEntry = { type: "output", result };
      setHistory((current) => {
        const lastEntry = current.at(-1);
        const canReplace =
          hasLiveOutput &&
          lastEntry?.type === "output" &&
          lastEntry.result.commandLine === commandLine;
        return [...(canReplace ? current.slice(0, -1) : current), entry].slice(-20);
      });
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
        setActiveAgentKind(undefined);
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
    <AppLayout
      sessionHeader={sessionHeader}
      isRunning={isRunning}
      historyViewportHeight={historyViewportHeight}
      visibleHistoryRows={visibleHistoryRows}
      promptLine={promptLine}
      statusPaneWidths={statusPaneWidths}
      statusBar={statusBar}
    />
  );
}

function hasAfterSuccessReview(
  result: CommandRunOutput,
): result is CommandRunOutput & {
  kind: "execute";
  afterSuccess: Promise<string | void>;
  afterSuccessAgentKind?: "command" | "lark";
} {
  return result.kind === "execute" && Boolean(result.afterSuccess);
}
