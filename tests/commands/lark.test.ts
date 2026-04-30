import assert from "node:assert/strict";
import { basename } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";

import { createLarkCliOutputForwarder, createLarkCommand } from "../../src/commands/lark.js";

test("lark init triggers the lark authorization agent phase", async () => {
  let capturedContext: unknown;
  const output = createStringWritable();
  const command = createLarkCommand({
    agent: {
      authorize: async (context) => {
        capturedContext = context;
        return { content: "auth phase ready" };
      },
    },
    stdout: output,
  });

  await command.parseAsync(["node", "test", "init"]);

  assert.equal((capturedContext as { cwd?: string }).cwd, process.cwd());
  assert.equal((capturedContext as { intent?: string }).intent, "init");
  assert.equal(
    (capturedContext as { projectHints?: { cwdName?: string } }).projectHints?.cwdName,
    basename(process.cwd()),
  );
  assert.equal(output.text, "auth phase ready\n");
});

test("lark CLI output forwarder writes tool output to terminal streams", () => {
  const stdout = createStringWritable();
  const stderr = createStringWritable();
  const forward = createLarkCliOutputForwarder({ stdout, stderr });

  forward({ stream: "stdout", text: "Open this login URL\n" });
  forward({ stream: "stderr", text: "waiting for authorization\n" });

  assert.equal(stdout.text, "Open this login URL\n");
  assert.equal(stderr.text, "waiting for authorization\n");
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
