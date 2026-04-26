import React from "react";
import { render, type Instance, type RenderOptions } from "ink";

import { App } from "./app.js";

export const CLEAR_TERMINAL_SEQUENCE = "\u001b[2J\u001b[H";
export const ENABLE_MOUSE_WHEEL_SEQUENCE = "\u001b[?1000h\u001b[?1006h";
export const DISABLE_MOUSE_WHEEL_SEQUENCE = "\u001b[?1006l\u001b[?1000l";

type WritableStream = {
  write: (chunk: string) => unknown;
};

type TuiRenderer = typeof render;

export function clearTerminal(stream: WritableStream = process.stdout) {
  stream.write(CLEAR_TERMINAL_SEQUENCE);
}

export function getTuiRenderOptions(): RenderOptions {
  return {
    alternateScreen: false,
    incrementalRendering: true,
  };
}

export function renderTui(
  stream: WritableStream = process.stdout,
  renderer: TuiRenderer = render,
): Instance {
  clearTerminal(stream);
  const instance = renderer(<App />, getTuiRenderOptions());
  instance.waitUntilExit().then(
    () => clearTerminal(stream),
    () => clearTerminal(stream),
  );
  return instance;
}
