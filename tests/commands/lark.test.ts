import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { createLarkCommand } from "../../src/commands/lark.js";

test("lark init triggers the lark authorization agent phase", async () => {
  let capturedContext: unknown;
  const output = createStringWritable();
  const command = createLarkCommand({
    agent: {
      authorize: async (context) => {
        capturedContext = context;
        return "auth phase ready";
      },
    },
    stdout: output,
  });

  await command.parseAsync(["node", "test", "init"]);

  assert.deepEqual(capturedContext, {
    cwd: process.cwd(),
    intent: "init",
  });
  assert.equal(output.text, "auth phase ready\n");
});

function createStringWritable() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });

  return Object.defineProperty(stream, "text", {
    get() {
      return chunks.join("");
    },
  }) as Writable & { text: string };
}
