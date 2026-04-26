import React from "react";
import { render, type Instance, type RenderOptions } from "ink";

import { App } from "./app.js";

export const CLEAR_TERMINAL_SEQUENCE = "\u001b[2J\u001b[H";
export const ENABLE_MOUSE_WHEEL_SEQUENCE = "\u001b[?1000h\u001b[?1006h";
export const DISABLE_MOUSE_WHEEL_SEQUENCE =
  "\u001b[?1006l\u001b[?1015l\u001b[?1005l\u001b[?1003l\u001b[?1002l\u001b[?1000l";

type WritableStream = {
  write: (chunk: string) => unknown;
};

type TuiRenderer = typeof render;

export function clearTerminal(stream: WritableStream = process.stdout) {
  stream.write(CLEAR_TERMINAL_SEQUENCE);
}

export function disableMouseReporting(stream: WritableStream = process.stdout) {
  stream.write(DISABLE_MOUSE_WHEEL_SEQUENCE);
}

export function shouldEnableMouseWheelReporting(
  env: Partial<Pick<NodeJS.ProcessEnv, "GIT_HELPER_TUI_MOUSE">> = process.env,
) {
  const value = env.GIT_HELPER_TUI_MOUSE?.trim().toLowerCase();
  return !value || !["0", "false", "off", "no"].includes(value);
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
  disableMouseReporting(stream);
  clearTerminal(stream);
  const instance = renderer(<App />, getTuiRenderOptions());
  instance.waitUntilExit().then(
    () => {
      disableMouseReporting(stream);
      clearTerminal(stream);
    },
    () => {
      disableMouseReporting(stream);
      clearTerminal(stream);
    },
  );
  return instance;
}
