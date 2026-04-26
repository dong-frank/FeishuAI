import assert from "node:assert/strict";
import test from "node:test";

import {
  clearTerminal,
  CLEAR_TERMINAL_SEQUENCE,
  getTuiRenderOptions,
  renderTui,
} from "../../src/tui/render.js";

test("clearTerminal writes the ANSI clear screen sequence", () => {
  let output = "";
  const stream = {
    write(chunk: string) {
      output += chunk;
      return true;
    },
  };

  clearTerminal(stream);

  assert.equal(CLEAR_TERMINAL_SEQUENCE, "\u001b[2J\u001b[H");
  assert.equal(output, CLEAR_TERMINAL_SEQUENCE);
});

test("TUI render options preserve terminal scrollback for text selection", () => {
  assert.deepEqual(getTuiRenderOptions(), {
    alternateScreen: false,
    incrementalRendering: true,
  });
});

test("renderTui clears the terminal before rendering and after exit", async () => {
  let output = "";
  let resolveExit: (value: unknown) => void = () => {};
  const waitUntilExit = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const stream = {
    write(chunk: string) {
      output += chunk;
      return true;
    },
  };
  let didRender = false;
  const instance = {
    waitUntilExit: () => waitUntilExit,
    rerender() {},
    unmount() {},
    waitUntilRenderFlush: async () => {},
    cleanup() {},
    clear() {},
  };

  renderTui(stream, (() => {
    didRender = true;
    assert.equal(output, CLEAR_TERMINAL_SEQUENCE);
    return instance;
  }) as never);

  assert.equal(didRender, true);
  assert.equal(output, CLEAR_TERMINAL_SEQUENCE);

  resolveExit(undefined);
  await waitUntilExit;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(output, `${CLEAR_TERMINAL_SEQUENCE}${CLEAR_TERMINAL_SEQUENCE}`);
});
