import React from "react";
import { render, type RenderOptions } from "ink";

import { App } from "./app.js";

export const CLEAR_TERMINAL_SEQUENCE = "\u001b[2J\u001b[H";

type WritableStream = {
  write: (chunk: string) => unknown;
};

export function clearTerminal(stream: WritableStream = process.stdout) {
  stream.write(CLEAR_TERMINAL_SEQUENCE);
}

export function getTuiRenderOptions(): RenderOptions {
  return {
    alternateScreen: true,
    incrementalRendering: true,
  };
}

export function renderTui() {
  render(<App />, getTuiRenderOptions());
}
