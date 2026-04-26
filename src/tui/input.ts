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
