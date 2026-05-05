import React, { useEffect, useRef, useState } from "react";
import { useApp, useInput, useStdout } from "ink";

import type {
  CommandAgent,
  CommandAgentOutput,
  CommandChatContext,
  CommandContext,
  AgentToolProgressEvent,
  AgentRunMetadata,
  LarkAgent,
} from "../agent/types.js";
import { createCommandAgent } from "../agent/command-agent.js";
import { createLarkAgent } from "../agent/lark-agent.js";
import { classifyCommand } from "../runtime/command-registry.js";
import { getCompletion } from "../runtime/completion.js";
import {
  parseCommandLine,
  runCommandLine as defaultRunCommandLine,
  type CommandOutputChunk,
  type CommandRunOutput,
  type RunCommandLineOptions,
} from "../runtime/command-runner.js";
import {
  createExperimentRecorder as defaultCreateExperimentRecorder,
  type ExperimentRecorder,
  type ExperimentRecordInput,
} from "../runtime/experiment-recorder.js";
import {
  initializeTuiSession as defaultInitializeTuiSession,
  type TuiSessionInfo,
} from "../runtime/tui-session.js";
import { AppLayout, getPromptViewportWidth } from "./layout.js";
import {
  getHistoryRows,
  getHistoryViewportHeight,
  getHistoryViewportWidth,
  getNextHistoryScrollOffset,
  getVisibleHistoryRows,
  omitCompletedAgentToolProgress,
  replaceAgentHistoryEntry,
  upsertAgentToolProgress,
  type AgentHistoryEntry,
  type HistoryEntry,
  type HistoryScrollAction,
} from "./history.js";
import {
  getNextCommandHistoryInput,
  getNextEditableInput,
  getNextRightArrowInput,
  getAgentSuggestedCompletion,
  getPromptLineParts,
  getTuiMouseInputAction,
  getTuiMouseWheelAction,
} from "./input.js";
import {
  DISABLE_MOUSE_WHEEL_SEQUENCE,
  ENABLE_MOUSE_WHEEL_SEQUENCE,
  shouldEnableMouseWheelReporting,
} from "./render.js";
import {
  buildBeforeRunContext,
  buildChatCommandContext,
  getSessionHeaderParts,
  isChatCommandInput,
  shouldRefreshSessionAfterCommand,
  shouldIgnoreTabAgentTrigger,
  shouldTriggerBeforeRunOnTab,
} from "./runtime.js";
import {
  getStatusPaneWidths,
  resolveMaxContextWindow,
  type AgentKind,
  type ContextMeterState,
} from "./status.js";

export * from "./constants.js";
export * from "./history.js";
export * from "./input.js";
export * from "./output.js";
export * from "./runtime.js";
export * from "./status.js";

type AppProps = {
  autoRunLarkInit?: boolean;
  initialCwd?: string;
  initializeSession?: typeof defaultInitializeTuiSession;
  runCommandLine?: (
    commandLine: string,
    options?: RunCommandLineOptions,
  ) => Promise<CommandRunOutput>;
};

export function App({
  autoRunLarkInit = true,
  initialCwd = process.cwd(),
  initializeSession = defaultInitializeTuiSession,
  runCommandLine = defaultRunCommandLine,
}: AppProps = {}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [currentCwd, setCurrentCwd] = useState(initialCwd);
  const [session, setSession] = useState<TuiSessionInfo | undefined>();
  const [input, setInput] = useState("");
  const [cursorIndex, setCursorIndex] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isAgentWaiting, setIsAgentWaiting] = useState(false);
  const [isAgentReviewing, setIsAgentReviewing] = useState(false);
  const [activeAgentKind, setActiveAgentKind] = useState<AgentKind | undefined>();
  const [agentStatusCommand, setAgentStatusCommand] = useState<string | undefined>();
  const [agentSuggestedCommand, setAgentSuggestedCommand] = useState<string | undefined>();
  const [contextMeters, setContextMeters] = useState<ContextMeterState>({});
  const lastTabAgentInput = useRef<string | undefined>(undefined);
  const larkOutputHandler = useRef<((chunk: CommandOutputChunk) => void) | undefined>(undefined);
  const agentToolProgressHandler = useRef<
    ((event: AgentToolProgressEvent) => void) | undefined
  >(undefined);
  const larkAgent = useRef<LarkAgent | undefined>(undefined);
  const commandAgent = useRef<CommandAgent | undefined>(undefined);
  const experimentRecorder = useRef<ExperimentRecorder | undefined>(undefined);
  const nextAgentHistoryId = useRef(1);
  const didAutoRunLarkInit = useRef(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyScrollOffset, setHistoryScrollOffset] = useState(0);
  const [commandHistoryIndex, setCommandHistoryIndex] = useState<number | undefined>();
  const [commandHistoryDraft, setCommandHistoryDraft] = useState("");
  const completion = getCompletion(input, currentCwd);
  const agentCompletion = getAgentSuggestedCompletion({
    input,
    suggestedCommand: agentSuggestedCommand,
  });
  const visibleCompletion = agentCompletion ?? completion;
  const promptLine = getPromptLineParts({
    input,
    cursorIndex,
    completionSuffix: visibleCompletion?.suffix,
  });
  const statusPaneWidths = getStatusPaneWidths(stdout.columns);
  const maxContextWindow = resolveMaxContextWindow();
  const statusState = {
    isRunning,
    isAgentWaiting,
    isAgentReviewing,
    agentKind: activeAgentKind,
    agentCommand: agentStatusCommand,
  };
  const sessionHeader = getSessionHeaderParts(session);
  const historyViewportHeight = getHistoryViewportHeight(stdout.rows);
  const historyViewportWidth = getHistoryViewportWidth(stdout.columns);
  const promptViewportWidth = getPromptViewportWidth(stdout.columns);
  const historyRows = getHistoryRows(history, historyViewportWidth);
  const commandHistory = history
    .filter((entry): entry is Extract<HistoryEntry, { type: "input" }> => entry.type === "input")
    .map((entry) => entry.text);
  const historyRowLimit = historyViewportHeight;
  const visibleHistoryRows = getVisibleHistoryRows(
    history,
    historyRowLimit,
    historyScrollOffset,
    historyViewportWidth,
  );

  if (!larkAgent.current) {
    larkAgent.current = createLarkAgent({
      onLarkCliOutput(chunk) {
        larkOutputHandler.current?.(chunk);
      },
      onToolProgress(event) {
        agentToolProgressHandler.current?.(event);
      },
    });
  }

  if (!commandAgent.current) {
    commandAgent.current = createCommandAgent({
      larkAgent: larkAgent.current,
      onToolProgress(event) {
        agentToolProgressHandler.current?.(event);
      },
    });
  }

  useEffect(() => {
    let cancelled = false;
    void refreshSession(currentCwd, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, [currentCwd]);

  useEffect(() => {
    if (!autoRunLarkInit || didAutoRunLarkInit.current) {
      return;
    }

    didAutoRunLarkInit.current = true;
    void runTuiCommand("lark init", { allowExit: false });
  }, [autoRunLarkInit]);

  useEffect(() => {
    let cancelled = false;

    void defaultCreateExperimentRecorder(currentCwd).then((recorder) => {
      if (!cancelled) {
        if (!recorder) {
          experimentRecorder.current = undefined;
          return;
        }
        if (experimentRecorder.current?.marker.path === recorder.marker.path) {
          return;
        }
        experimentRecorder.current = recorder;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentCwd]);

  useEffect(() => {
    if (!stdout.isTTY || !shouldEnableMouseWheelReporting()) {
      return;
    }

    stdout.write(ENABLE_MOUSE_WHEEL_SEQUENCE);

    return () => {
      stdout.write(DISABLE_MOUSE_WHEEL_SEQUENCE);
    };
  }, [stdout]);

  async function refreshSession(
    cwd: string = currentCwd,
    isCancelled: () => boolean = () => false,
  ) {
    try {
      const nextSession = await initializeSession({ cwd });
      if (!isCancelled()) {
        setSession(nextSession);
      }
    } catch {
      // Session information is auxiliary; command interaction should keep working.
    }
  }

  function recordExperimentEvent(event: ExperimentRecordInput) {
    void experimentRecorder.current?.record(event).catch(() => {
      // Experiment recording must never interrupt the manual TUI flow.
    });
  }

  useInput((character, key) => {
    const mouseAction = getTuiMouseInputAction(character);
    if (mouseAction) {
      if (mouseAction.kind === "wheel") {
        scrollHistory(mouseAction.action);
      }
      return;
    }

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

    if (isRunning) {
      return;
    }

    if (key.upArrow) {
      navigateCommandHistory("previous");
      return;
    }

    if (key.downArrow) {
      navigateCommandHistory("next");
      return;
    }

    if (key.return) {
      void submitInput();
      return;
    }

    if (key.tab) {
      void triggerTabAgent();
      return;
    }

    if (key.leftArrow) {
      const next = getNextEditableInput({ input, cursorIndex }, "left");
      setCursorIndex(next.cursorIndex);
      return;
    }

    if (key.rightArrow) {
      const next = getNextRightArrowInput({ input, cursorIndex, completion, agentCompletion });
      if (next.input !== input) {
        lastTabAgentInput.current = undefined;
        setAgentSuggestedCommand(undefined);
        resetCommandHistoryNavigation();
      }
      setInput(next.input);
      setCursorIndex(next.cursorIndex);
      return;
    }

    if (key.backspace) {
      const next = getNextEditableInput({ input, cursorIndex }, "backspace");
      setInput(next.input);
      setCursorIndex(next.cursorIndex);
      lastTabAgentInput.current = undefined;
      resetCommandHistoryNavigation();
      return;
    }

    if (key.delete) {
      const next = getNextEditableInput({ input, cursorIndex }, "delete");
      setInput(next.input);
      setCursorIndex(next.cursorIndex);
      lastTabAgentInput.current = undefined;
      resetCommandHistoryNavigation();
      return;
    }

    if (character) {
      const next = getNextEditableInput(
        { input, cursorIndex },
        { type: "insert", text: character },
      );
      setInput(next.input);
      setCursorIndex(next.cursorIndex);
      lastTabAgentInput.current = undefined;
      resetCommandHistoryNavigation();
    }
  });

  function resetCommandHistoryNavigation() {
    setCommandHistoryIndex(undefined);
    setCommandHistoryDraft("");
  }

  function navigateCommandHistory(action: "previous" | "next") {
    const next = getNextCommandHistoryInput(
      {
        commands: commandHistory,
        currentInput: input,
        currentIndex: commandHistoryIndex,
        draftInput: commandHistoryDraft,
      },
      action,
    );
    setInput(next.input);
    setCursorIndex(next.cursorIndex);
    lastTabAgentInput.current = undefined;
    setCommandHistoryIndex(next.historyIndex);
    setCommandHistoryDraft(next.draftInput);
  }

  async function triggerTabAgent() {
    const commandLine = input.trim();
    if (
      !commandLine ||
      shouldIgnoreTabAgentTrigger({
        input: commandLine,
        lastTriggeredInput: lastTabAgentInput.current,
        isAgentBusy: isAgentWaiting || isAgentReviewing,
      })
    ) {
      return;
    }

    if (
      !shouldTriggerBeforeRunOnTab({
        input: commandLine,
        completionSuffix: completion?.suffix,
        isRunning,
      })
    ) {
      return;
    }

    const context = await buildBeforeRunContext(commandLine, currentCwd, session);
    if (!context) {
      return;
    }

    lastTabAgentInput.current = context.rawCommand;
    await triggerBeforeRun(context);
  }

  async function triggerBeforeRun(context: CommandContext) {
    const agentHistoryId = appendPendingAgentHistoryEntry("command", context.rawCommand, "waiting");
    const updateToolProgress = createAgentToolProgressHandler(agentHistoryId);
    setIsAgentWaiting(true);
    setActiveAgentKind("command");
    setAgentStatusCommand(context.rawCommand);
    try {
      agentToolProgressHandler.current = updateToolProgress;
      const message = await commandAgent.current?.beforeRun?.(context);
      if (!message) {
        recordExperimentEvent({
          type: "agent_completed",
          cwd: context.cwd,
          command: context.rawCommand,
          phase: "beforeRun",
          agentKind: "command",
          content: "",
        });
        updateAgentHistoryEntry(agentHistoryId, { state: "empty" });
        return;
      }
      recordExperimentEvent({
        type: "agent_completed",
        cwd: context.cwd,
        command: context.rawCommand,
        phase: "beforeRun",
        agentKind: "command",
        content: message.content,
        ...(message.suggestedCommand ? { suggestedCommand: message.suggestedCommand } : {}),
        ...(message.metadata ? { metadata: message.metadata } : {}),
      });
      rememberAgentContextUsage("command", message.metadata);
      setAgentSuggestedCommand(message.suggestedCommand);

      updateAgentHistoryEntry(agentHistoryId, {
        state: "success",
        content: message.content,
        ...(message.metadata ? { metadata: message.metadata } : {}),
      });
      setHistoryScrollOffset(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordExperimentEvent({
        type: "agent_failed",
        cwd: context.cwd,
        command: context.rawCommand,
        phase: "beforeRun",
        agentKind: "command",
        error: message,
      });
      updateAgentHistoryEntry(agentHistoryId, {
        state: "failed",
        error: message,
      });
      setHistoryScrollOffset(0);
    } finally {
      if (agentToolProgressHandler.current === updateToolProgress) {
        agentToolProgressHandler.current = undefined;
      }
      setIsAgentWaiting(false);
      setActiveAgentKind(undefined);
      setAgentStatusCommand(undefined);
    }
  }

  async function triggerAfterSuccessReview(
    result: CommandRunOutput & {
      kind: "execute";
      afterSuccess: Promise<CommandAgentOutput | string | void>;
      afterSuccessAgentKind?: "command" | "lark";
    },
    options: {
      onAgentHistoryEntryCreated?: (
        id: string,
        agentKind: AgentKind,
      ) => void;
    } = {},
  ) {
    const agentKind = result.afterSuccessAgentKind ?? "command";
    const agentHistoryId = appendPendingAgentHistoryEntry(agentKind, result.commandLine, "reviewing");
    const updateToolProgress = createAgentToolProgressHandler(agentHistoryId);
    options.onAgentHistoryEntryCreated?.(agentHistoryId, agentKind);
    const updateLarkReviewOutput =
      agentKind === "lark"
        ? (chunk: CommandOutputChunk) => appendAgentHistoryOutput(agentHistoryId, chunk)
        : undefined;
    setIsAgentReviewing(true);
    setActiveAgentKind(agentKind);
    setAgentStatusCommand(result.commandLine);
    try {
      agentToolProgressHandler.current = updateToolProgress;
      if (updateLarkReviewOutput) {
        larkOutputHandler.current = updateLarkReviewOutput;
      }
      const output = normalizeAgentOutput(await result.afterSuccess);
      if (!output) {
        recordExperimentEvent({
          type: "agent_completed",
          cwd: currentCwd,
          command: result.commandLine,
          phase: "afterSuccess",
          agentKind,
          content: "",
        });
        updateAgentHistoryEntry(agentHistoryId, { state: "empty" });
        return;
      }
      recordExperimentEvent({
        type: "agent_completed",
        cwd: currentCwd,
        command: result.commandLine,
        phase: "afterSuccess",
        agentKind,
        content: output.content,
        ...(output.suggestedCommand ? { suggestedCommand: output.suggestedCommand } : {}),
        ...(output.metadata ? { metadata: output.metadata } : {}),
      });
      rememberAgentContextUsage(agentKind, output.metadata);
      setAgentSuggestedCommand(output.suggestedCommand);

      updateAgentHistoryEntry(agentHistoryId, {
        state: "success",
        content: output.content,
        ...(output.metadata ? { metadata: output.metadata } : {}),
      });
      setHistoryScrollOffset(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordExperimentEvent({
        type: "agent_failed",
        cwd: currentCwd,
        command: result.commandLine,
        phase: "afterSuccess",
        agentKind,
        error: message,
      });
      updateAgentHistoryEntry(agentHistoryId, {
        state: "failed",
        error: message,
      });
    } finally {
      if (agentToolProgressHandler.current === updateToolProgress) {
        agentToolProgressHandler.current = undefined;
      }
      if (updateLarkReviewOutput && larkOutputHandler.current === updateLarkReviewOutput) {
        larkOutputHandler.current = undefined;
      }
      setIsAgentReviewing(false);
      setActiveAgentKind(undefined);
      setAgentStatusCommand(undefined);
    }
  }

  async function triggerAfterFailReview(
    result: CommandRunOutput & {
      kind: "execute";
      afterFail: Promise<CommandAgentOutput | void>;
      afterFailAgentKind?: "command";
    },
    options: {
      onAgentHistoryEntryCreated?: (id: string, agentKind: AgentKind) => void;
    } = {},
  ) {
    const agentKind = result.afterFailAgentKind ?? "command";
    const agentHistoryId = appendPendingAgentHistoryEntry(agentKind, result.commandLine, "reviewing");
    const updateToolProgress = createAgentToolProgressHandler(agentHistoryId);
    options.onAgentHistoryEntryCreated?.(agentHistoryId, agentKind);
    setIsAgentReviewing(true);
    setActiveAgentKind(agentKind);
    setAgentStatusCommand(result.commandLine);
    try {
      agentToolProgressHandler.current = updateToolProgress;
      const output = normalizeAgentOutput(await result.afterFail);
      if (!output) {
        recordExperimentEvent({
          type: "agent_completed",
          cwd: currentCwd,
          command: result.commandLine,
          phase: "afterFail",
          agentKind,
          content: "",
        });
        updateAgentHistoryEntry(agentHistoryId, { state: "empty" });
        return;
      }
      recordExperimentEvent({
        type: "agent_completed",
        cwd: currentCwd,
        command: result.commandLine,
        phase: "afterFail",
        agentKind,
        content: output.content,
        ...(output.suggestedCommand ? { suggestedCommand: output.suggestedCommand } : {}),
        ...(output.metadata ? { metadata: output.metadata } : {}),
      });
      rememberAgentContextUsage(agentKind, output.metadata);
      setAgentSuggestedCommand(output.suggestedCommand);

      updateAgentHistoryEntry(agentHistoryId, {
        state: "success",
        content: output.content,
        ...(output.metadata ? { metadata: output.metadata } : {}),
      });
      setHistoryScrollOffset(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordExperimentEvent({
        type: "agent_failed",
        cwd: currentCwd,
        command: result.commandLine,
        phase: "afterFail",
        agentKind,
        error: message,
      });
      updateAgentHistoryEntry(agentHistoryId, {
        state: "failed",
        error: message,
      });
    } finally {
      if (agentToolProgressHandler.current === updateToolProgress) {
        agentToolProgressHandler.current = undefined;
      }
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

    setAgentSuggestedCommand(undefined);
    setInput("");
    setCursorIndex(0);
    lastTabAgentInput.current = undefined;
    resetCommandHistoryNavigation();

    await runTuiCommand(commandLine);
  }

  async function runTuiCommand(
    commandLine: string,
    options: { allowExit?: boolean } = {},
  ) {
    const allowExit = options.allowExit ?? true;
    setHistory((current) => [
      ...omitCompletedAgentToolProgress(current),
      { type: "input", text: commandLine },
    ]);
    setHistoryScrollOffset(0);

    if (allowExit && (commandLine === "exit" || commandLine === "quit")) {
      exit();
      return;
    }

    if (isChatCommandInput(commandLine)) {
      const chatContext = buildChatCommandContext({
        input: commandLine,
        cwd: currentCwd,
        session,
      });
      if (!chatContext) {
        setHistory((current) => [
          ...current,
          { type: "system" as const, text: "Usage: /chat <message>" },
        ].slice(-20));
        setHistoryScrollOffset(0);
        return;
      }

      void triggerChat(chatContext);
      return;
    }

    const executionCwd = currentCwd;
    recordExperimentEvent({
      type: "command_submitted",
      cwd: executionCwd,
      command: commandLine,
    });

    setIsRunning(true);
    const parsed = parseCommandLine(commandLine);
    const classification = parsed ? classifyCommand(parsed) : undefined;
    let liveStdout = "";
    let liveStderr = "";
    let hasLiveOutput = false;
    let larkAgentHistoryId: string | undefined;
    const bufferedLarkAgentChunks: CommandOutputChunk[] = [];
    let reviewAgentHistoryId: string | undefined;
    const bufferedAgentToolProgressEvents: AgentToolProgressEvent[] = [];

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
    const updateAgentLiveOutput = (chunk: CommandOutputChunk) => {
      if (!larkAgentHistoryId) {
        bufferedLarkAgentChunks.push(chunk);
        return;
      }

      appendAgentHistoryOutput(larkAgentHistoryId, chunk);
    };
    const updateReviewAgentToolProgress = (event: AgentToolProgressEvent) => {
      if (!reviewAgentHistoryId) {
        bufferedAgentToolProgressEvents.push(event);
        return;
      }

      appendAgentToolProgress(reviewAgentHistoryId, event);
    };
    const bindReviewAgentHistoryEntry = (id: string) => {
      reviewAgentHistoryId = id;
      for (const event of bufferedAgentToolProgressEvents.splice(0)) {
        appendAgentToolProgress(id, event);
      }
    };

    try {
      larkOutputHandler.current = updateAgentLiveOutput;
      agentToolProgressHandler.current = updateReviewAgentToolProgress;
      const result = await runCommandLine(commandLine, {
        cwd: executionCwd,
        ...(commandAgent.current ? { agent: commandAgent.current } : {}),
        ...(larkAgent.current ? { larkAgent: larkAgent.current } : {}),
        onOutput: updateUserLiveOutput,
      });
      if (result.kind === "execute") {
        recordExperimentEvent({
          type: "command_completed",
          cwd: executionCwd,
          command: result.commandLine,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          ...(typeof result.durationMs === "number" ? { durationMs: result.durationMs } : {}),
        });
      }
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
      if (result.kind === "execute" && result.nextCwd) {
        setCurrentCwd(result.nextCwd);
      }
      if (shouldRefreshSessionAfterCommand(result)) {
        void refreshSession(result.nextCwd ?? currentCwd);
      }
      if (hasAfterSuccessReview(result)) {
        void triggerAfterSuccessReview(result, {
          onAgentHistoryEntryCreated(id, agentKind) {
            bindReviewAgentHistoryEntry(id);
            if (agentKind !== "lark") {
              return;
            }

            larkAgentHistoryId = id;
            for (const chunk of bufferedLarkAgentChunks.splice(0)) {
              appendAgentHistoryOutput(id, chunk);
            }
          },
        });
      }
      if (hasAfterFailReview(result)) {
        void triggerAfterFailReview(result, {
          onAgentHistoryEntryCreated(id) {
            bindReviewAgentHistoryEntry(id);
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const entry: HistoryEntry = { type: "system", text: message };
      setHistory((current) => [...current, entry].slice(-20));
      setHistoryScrollOffset(0);
    } finally {
      if (larkOutputHandler.current === updateAgentLiveOutput) {
        larkOutputHandler.current = undefined;
      }
      if (agentToolProgressHandler.current === updateReviewAgentToolProgress) {
        agentToolProgressHandler.current = undefined;
      }
      setIsRunning(false);
    }
  }

  async function triggerChat(context: CommandChatContext) {
    const agentHistoryId = appendPendingAgentHistoryEntry("command", context.rawCommand, "waiting");
    const updateToolProgress = createAgentToolProgressHandler(agentHistoryId);
    setIsAgentWaiting(true);
    setActiveAgentKind("command");
    setAgentStatusCommand(context.rawCommand);
    try {
      agentToolProgressHandler.current = updateToolProgress;
      const message = await commandAgent.current?.chat?.(context);
      if (!message) {
        recordExperimentEvent({
          type: "agent_completed",
          cwd: context.cwd,
          command: context.rawCommand,
          phase: "chat",
          agentKind: "command",
          content: "",
        });
        updateAgentHistoryEntry(agentHistoryId, { state: "empty" });
        return;
      }
      recordExperimentEvent({
        type: "agent_completed",
        cwd: context.cwd,
        command: context.rawCommand,
        phase: "chat",
        agentKind: "command",
        content: message.content,
        ...(message.suggestedCommand ? { suggestedCommand: message.suggestedCommand } : {}),
        ...(message.metadata ? { metadata: message.metadata } : {}),
      });
      rememberAgentContextUsage("command", message.metadata);
      setAgentSuggestedCommand(message.suggestedCommand);

      updateAgentHistoryEntry(agentHistoryId, {
        state: "success",
        content: message.content,
        ...(message.metadata ? { metadata: message.metadata } : {}),
      });
      setHistoryScrollOffset(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordExperimentEvent({
        type: "agent_failed",
        cwd: context.cwd,
        command: context.rawCommand,
        phase: "chat",
        agentKind: "command",
        error: message,
      });
      updateAgentHistoryEntry(agentHistoryId, {
        state: "failed",
        error: message,
      });
      setHistoryScrollOffset(0);
    } finally {
      if (agentToolProgressHandler.current === updateToolProgress) {
        agentToolProgressHandler.current = undefined;
      }
      setIsAgentWaiting(false);
      setActiveAgentKind(undefined);
      setAgentStatusCommand(undefined);
    }
  }

  function scrollHistory(action: HistoryScrollAction) {
    setHistoryScrollOffset((current) =>
      getNextHistoryScrollOffset(current, action, historyRows.length, historyRowLimit),
    );
  }

  function appendPendingAgentHistoryEntry(
    agentKind: AgentKind,
    commandLine: string,
    activity: AgentHistoryEntry["activity"] = "waiting",
  ) {
    const id = `agent-${nextAgentHistoryId.current}`;
    nextAgentHistoryId.current += 1;
    const entry: AgentHistoryEntry = {
      type: "agent",
      id,
      agentKind,
      commandLine,
      state: "pending",
      activity,
    };
    setHistory((current) => [...current, entry].slice(-20));
    setHistoryScrollOffset(0);
    return id;
  }

  function updateAgentHistoryEntry(
    id: string,
    patch: Partial<Omit<AgentHistoryEntry, "type" | "id" | "agentKind" | "commandLine">>,
  ) {
    setHistory((current) => replaceAgentHistoryEntry(current, id, patch));
    setHistoryScrollOffset(0);
  }

  function appendAgentHistoryOutput(id: string, chunk: CommandOutputChunk) {
    setHistory((current) =>
      replaceAgentHistoryEntry(current, id, {
        ...(chunk.stream === "stdout"
          ? {
              stdout: `${getAgentHistoryOutput(current, id, "stdout")}${chunk.text}`,
            }
          : {
              stderr: `${getAgentHistoryOutput(current, id, "stderr")}${chunk.text}`,
            }),
      }),
    );
    setHistoryScrollOffset(0);
  }

  function createAgentToolProgressHandler(id: string) {
    return (event: AgentToolProgressEvent) => appendAgentToolProgress(id, event);
  }

  function appendAgentToolProgress(id: string, event: AgentToolProgressEvent) {
    setHistory((current) =>
      replaceAgentHistoryEntry(current, id, {
        toolProgress: upsertAgentToolProgress(getAgentToolProgress(current, id), event),
      }),
    );
    setHistoryScrollOffset(0);
  }

  function rememberAgentContextUsage(
    agentKind: AgentKind,
    metadata: AgentRunMetadata | undefined,
  ) {
    if (!metadata?.contextUsage) {
      return;
    }

    setContextMeters((current) => ({
      ...current,
      [agentKind]: metadata.contextUsage,
    }));
  }

  return (
    <AppLayout
      sessionHeader={sessionHeader}
      isRunning={isRunning}
      historyViewportHeight={historyViewportHeight}
      visibleHistoryRows={visibleHistoryRows}
      promptLine={promptLine}
      promptViewportWidth={promptViewportWidth}
      statusPaneWidths={statusPaneWidths}
      statusState={statusState}
      contextMeters={contextMeters}
      maxContextWindow={maxContextWindow}
      viewportRows={stdout.rows}
    />
  );
}

function hasAfterSuccessReview(
  result: CommandRunOutput,
): result is CommandRunOutput & {
  kind: "execute";
  afterSuccess: Promise<CommandAgentOutput | string | void>;
  afterSuccessAgentKind?: "command" | "lark";
} {
  return result.kind === "execute" && Boolean(result.afterSuccess);
}

function hasAfterFailReview(
  result: CommandRunOutput,
): result is CommandRunOutput & {
  kind: "execute";
  afterFail: Promise<CommandAgentOutput | string | void>;
  afterFailAgentKind?: "command";
} {
  return result.kind === "execute" && Boolean(result.afterFail);
}

function getAgentHistoryOutput(
  history: HistoryEntry[],
  id: string,
  stream: "stdout" | "stderr",
) {
  const entry = history.find(
    (candidate): candidate is AgentHistoryEntry =>
      candidate.type === "agent" && candidate.id === id,
  );
  return stream === "stdout" ? entry?.stdout ?? "" : entry?.stderr ?? "";
}

function getAgentToolProgress(history: HistoryEntry[], id: string) {
  const entry = history.find(
    (candidate): candidate is AgentHistoryEntry =>
      candidate.type === "agent" && candidate.id === id,
  );
  return entry?.toolProgress ?? [];
}

function normalizeAgentOutput(
  output: CommandAgentOutput | string | void,
): CommandAgentOutput | undefined {
  if (!output) {
    return undefined;
  }

  if (typeof output === "string") {
    const content = output.trim();
    return content ? { content } : undefined;
  }

  return output.content.trim()
    ? {
        content: output.content.trim(),
        ...(output.suggestedCommand?.trim()
          ? { suggestedCommand: output.suggestedCommand.trim() }
          : {}),
        ...(output.metadata ? { metadata: output.metadata } : {}),
      }
    : undefined;
}
