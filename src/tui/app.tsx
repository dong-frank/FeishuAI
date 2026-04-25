import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";

import { createCommandAgent } from "../agent/command-agent.js";
import { getCompletion } from "../runtime/completion.js";
import { runCommandLine, type CommandRunOutput } from "../runtime/command-runner.js";

type HistoryEntry =
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

export function App() {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([
    {
      type: "system",
      text: "Welcome to git-helper TUI. Type a command, or type exit to quit.",
    },
  ]);
  const completion = getCompletion(input);

  useInput((character, key) => {
    if (key.ctrl && character === "c") {
      exit();
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
      setInput(completion.completion);
      return;
    }

    if (key.backspace || key.delete) {
      setInput((current) => current.slice(0, -1));
      return;
    }

    if (character) {
      setInput((current) => `${current}${character}`);
    }
  });

  async function submitInput() {
    const commandLine = input.trim();
    if (!commandLine) {
      return;
    }

    setInput("");
    setHistory((current) => [...current, { type: "input", text: commandLine }]);

    if (commandLine === "exit" || commandLine === "quit") {
      exit();
      return;
    }

    setIsRunning(true);
    try {
      const result = await runCommandLine(commandLine, {
        agent: createCommandAgent(),
      });
      const entry: HistoryEntry = { type: "output", result };
      setHistory((current) => [...current, entry].slice(-20));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const entry: HistoryEntry = { type: "system", text: message };
      setHistory((current) => [...current, entry].slice(-20));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="single" paddingX={1} marginBottom={1}>
        <Text color="cyan">git-helper</Text>
        <Text> cwd: {process.cwd()}</Text>
        <Text color={isRunning ? "yellow" : "green"}>
          {" "}
          {isRunning ? "running" : "ready"}
        </Text>
      </Box>

      <Box flexDirection="column" minHeight={10}>
        {history.map((entry, index) => (
          <HistoryLine entry={entry} key={index} />
        ))}
      </Box>

      <Box borderStyle="single" paddingX={1} marginTop={1}>
        <Text color="green">$ </Text>
        <Text>{input}</Text>
        {completion ? <Text color="gray">{completion.suffix}</Text> : null}
        <Text color="gray">{isRunning ? " ..." : ""}</Text>
      </Box>

      <Text color="gray">Enter runs command. Tab completes. Ctrl+C exits.</Text>
    </Box>
  );
}

function HistoryLine({ entry }: { entry: HistoryEntry }) {
  if (entry.type === "input") {
    return (
      <Text>
        <Text color="green">$ </Text>
        {entry.text}
      </Text>
    );
  }

  if (entry.type === "system") {
    return <Text color="gray">{entry.text}</Text>;
  }

  const output = [entry.result.stdout, entry.result.stderr].filter(Boolean).join("");
  const classification = entry.result.classification?.kind;
  return (
    <Box flexDirection="column">
      {classification ? <Text color="gray">type: {classification}</Text> : null}
      {output ? <Text>{output.trimEnd()}</Text> : null}
      {entry.result.exitCode === 0 ? null : (
        <Text color="red">exit code: {entry.result.exitCode}</Text>
      )}
    </Box>
  );
}
