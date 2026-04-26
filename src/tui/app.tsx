import React, { useEffect, useRef, useState } from "react";
import { useApp, useInput, useStdout } from "ink";

import type { CommandAgentOutput, CommandContext } from "../agent/types.js";
import { createCommandAgent } from "../agent/command-agent.js";
import { createLarkAgent } from "../agent/lark-agent.js";
import { classifyCommand } from "../runtime/command-registry.js";
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
import { AppLayout, getPromptViewportWidth } from "./layout.js";
import {
  getHistoryRows,
  getHistoryViewportHeight,
  getHistoryViewportWidth,
  getNextHistoryScrollOffset,
  getVisibleHistoryRows,
  replaceAgentHistoryEntry,
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
  getSessionHeaderParts,
  shouldRefreshSessionAfterCommand,
  shouldIgnoreTabAgentTrigger,
  shouldTriggerBeforeRunOnTab,
} from "./runtime.js";
import { getStatusPaneWidths, type AgentKind } from "./status.js";

export * from "./constants.js";
export * from "./history.js";
export * from "./input.js";
export * from "./output.js";
export * from "./runtime.js";
export * from "./status.js";

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [currentCwd, setCurrentCwd] = useState(process.cwd());
  const [session, setSession] = useState<TuiSessionInfo | undefined>();
  const [input, setInput] = useState("");
  const [cursorIndex, setCursorIndex] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isAgentWaiting, setIsAgentWaiting] = useState(false);
  const [isAgentReviewing, setIsAgentReviewing] = useState(false);
  const [activeAgentKind, setActiveAgentKind] = useState<AgentKind | undefined>();
  const [agentStatusCommand, setAgentStatusCommand] = useState<string | undefined>();
  const [agentSuggestedCommand, setAgentSuggestedCommand] = useState<string | undefined>();
  const lastTabAgentInput = useRef<string | undefined>(undefined);
  const nextAgentHistoryId = useRef(1);
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

  useEffect(() => {
    let cancelled = false;
    void refreshSession(currentCwd, () => cancelled);

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
      const nextSession = await initializeTuiSession({ cwd });
      if (!isCancelled()) {
        setSession(nextSession);
      }
    } catch {
      // Session information is auxiliary; command interaction should keep working.
    }
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
    setIsAgentWaiting(true);
    setActiveAgentKind("command");
    setAgentStatusCommand(context.rawCommand);
    try {
      const message = await createCommandAgent().beforeRun?.(context);
      if (!message) {
        updateAgentHistoryEntry(agentHistoryId, { state: "empty" });
        return;
      }
      setAgentSuggestedCommand(message.suggestedCommand);

      updateAgentHistoryEntry(agentHistoryId, {
        state: "success",
        content: message.content,
        ...(message.metadata ? { metadata: message.metadata } : {}),
      });
      setHistoryScrollOffset(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateAgentHistoryEntry(agentHistoryId, {
        state: "failed",
        error: message,
      });
      setHistoryScrollOffset(0);
    } finally {
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
    options.onAgentHistoryEntryCreated?.(agentHistoryId, agentKind);
    setIsAgentReviewing(true);
    setActiveAgentKind(agentKind);
    setAgentStatusCommand(result.commandLine);
    try {
      const output = normalizeAgentOutput(await result.afterSuccess);
      if (!output) {
        updateAgentHistoryEntry(agentHistoryId, { state: "empty" });
        return;
      }
      setAgentSuggestedCommand(output.suggestedCommand);

      updateAgentHistoryEntry(agentHistoryId, {
        state: "success",
        content: output.content,
        ...(output.metadata ? { metadata: output.metadata } : {}),
      });
      setHistoryScrollOffset(0);
    } catch (error) {
      updateAgentHistoryEntry(agentHistoryId, {
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
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
  ) {
    const agentKind = result.afterFailAgentKind ?? "command";
    const agentHistoryId = appendPendingAgentHistoryEntry(agentKind, result.commandLine, "reviewing");
    setIsAgentReviewing(true);
    setActiveAgentKind(agentKind);
    setAgentStatusCommand(result.commandLine);
    try {
      const output = normalizeAgentOutput(await result.afterFail);
      if (!output) {
        updateAgentHistoryEntry(agentHistoryId, { state: "empty" });
        return;
      }
      setAgentSuggestedCommand(output.suggestedCommand);

      updateAgentHistoryEntry(agentHistoryId, {
        state: "success",
        content: output.content,
        ...(output.metadata ? { metadata: output.metadata } : {}),
      });
      setHistoryScrollOffset(0);
    } catch (error) {
      updateAgentHistoryEntry(agentHistoryId, {
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
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

    setAgentSuggestedCommand(undefined);
    setInput("");
    setCursorIndex(0);
    lastTabAgentInput.current = undefined;
    resetCommandHistoryNavigation();
    setHistory((current) => [...current, { type: "input", text: commandLine }]);
    setHistoryScrollOffset(0);

    if (commandLine === "exit" || commandLine === "quit") {
      exit();
      return;
    }

    setIsRunning(true);
    const parsed = parseCommandLine(commandLine);
    const classification = parsed ? classifyCommand(parsed) : undefined;
    let liveStdout = "";
    let liveStderr = "";
    let hasLiveOutput = false;
    let larkAgentHistoryId: string | undefined;
    const bufferedLarkAgentChunks: CommandOutputChunk[] = [];

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

    try {
      const result = await runCommandLine(commandLine, {
        cwd: currentCwd,
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
      if (result.kind === "execute" && result.nextCwd) {
        setCurrentCwd(result.nextCwd);
      }
      if (shouldRefreshSessionAfterCommand(result)) {
        void refreshSession(result.nextCwd ?? currentCwd);
      }
      if (hasAfterSuccessReview(result)) {
        void triggerAfterSuccessReview(result, {
          onAgentHistoryEntryCreated(id, agentKind) {
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
        void triggerAfterFailReview(result);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const entry: HistoryEntry = { type: "system", text: message };
      setHistory((current) => [...current, entry].slice(-20));
      setHistoryScrollOffset(0);
    } finally {
      setIsRunning(false);
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
