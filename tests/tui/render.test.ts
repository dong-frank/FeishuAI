import assert from "node:assert/strict";
import test from "node:test";

import {
  clearTerminal,
  CLEAR_TERMINAL_SEQUENCE,
  getTuiRenderOptions,
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

test("TUI render options enter alternate screen with incremental updates", () => {
  assert.deepEqual(getTuiRenderOptions(), {
    alternateScreen: true,
    incrementalRendering: true,
  });
});
