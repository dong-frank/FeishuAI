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

export type CompletionCandidate = {
  completion: string;
  suffix: string;
};

export type CommandHistoryNavigationState = {
  commands: string[];
  currentInput: string;
  currentIndex: number | undefined;
  draftInput: string;
};

export type CommandHistoryNavigationAction = "previous" | "next";

export type TuiMouseWheelAction = "wheelUp" | "wheelDown";

export type TuiMouseInputAction =
  | {
      kind: "wheel";
      action: TuiMouseWheelAction;
    }
  | {
      kind: "ignored";
    };

export type EditableInputAction =
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

export function getNextRightArrowInput({
  input,
  cursorIndex,
  completion,
}: EditableInput & {
  completion?: CompletionCandidate | undefined;
}): EditableInput {
  if (completion) {
    return {
      input: completion.completion,
      cursorIndex: completion.completion.length,
    };
  }

  return getNextEditableInput({ input, cursorIndex }, "right");
}

export function getNextCommandHistoryInput(
  state: CommandHistoryNavigationState,
  action: CommandHistoryNavigationAction,
): {
  input: string;
  cursorIndex: number;
  historyIndex: number | undefined;
  draftInput: string;
} {
  const commands = state.commands.filter((command) => command.trim());
  if (commands.length === 0) {
    return {
      input: state.currentInput,
      cursorIndex: state.currentInput.length,
      historyIndex: undefined,
      draftInput: state.draftInput,
    };
  }

  const draftInput = state.currentIndex === undefined ? state.currentInput : state.draftInput;

  if (action === "previous") {
    const historyIndex =
      state.currentIndex === undefined
        ? commands.length - 1
        : Math.max(0, state.currentIndex - 1);
    const input = commands[historyIndex] ?? "";

    return {
      input,
      cursorIndex: input.length,
      historyIndex,
      draftInput,
    };
  }

  if (state.currentIndex === undefined) {
    return {
      input: state.currentInput,
      cursorIndex: state.currentInput.length,
      historyIndex: undefined,
      draftInput,
    };
  }

  const historyIndex = state.currentIndex + 1;
  if (historyIndex >= commands.length) {
    return {
      input: draftInput,
      cursorIndex: draftInput.length,
      historyIndex: undefined,
      draftInput,
    };
  }

  const input = commands[historyIndex] ?? "";
  return {
    input,
    cursorIndex: input.length,
    historyIndex,
    draftInput,
  };
}

export function getTuiMouseWheelAction(input: string): TuiMouseWheelAction | undefined {
  const mouseAction = getTuiMouseInputAction(input);
  return mouseAction?.kind === "wheel" ? mouseAction.action : undefined;
}

export function getTuiMouseInputAction(input: string): TuiMouseInputAction | undefined {
  const match = /^\u001b?\[<(\d+);\d+;\d+[Mm]$/.exec(input);
  if (!match) {
    return undefined;
  }

  const buttonCode = Number(match[1]);
  const wheelButton = buttonCode & 0b11;
  if (buttonCode < 64) {
    return { kind: "ignored" };
  }

  if (wheelButton === 0) {
    return { kind: "wheel", action: "wheelUp" };
  }

  if (wheelButton === 1) {
    return { kind: "wheel", action: "wheelDown" };
  }

  return { kind: "ignored" };
}
