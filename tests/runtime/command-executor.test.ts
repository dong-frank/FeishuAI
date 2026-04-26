import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { executeCommand, getSpawnCommand } from "../../src/runtime/command-executor.js";

function captureStream() {
  let output = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });

  return {
    stream,
    output: () => output,
  };
}

test("executeCommand runs a command and forwards stdout", async () => {
  const stdout = captureStream();
  const stderr = captureStream();

  const exitCode = await executeCommand(
    "node",
    ["-e", "process.stdout.write('hello')"],
    { stdout: stdout.stream, stderr: stderr.stream },
  );

  assert.equal(exitCode, 0);
  assert.equal(stdout.output(), "hello");
  assert.equal(stderr.output(), "");
});

test("getSpawnCommand forces color for git commands", () => {
  assert.deepEqual(getSpawnCommand("git", ["status"]), {
    command: "git",
    args: ["-c", "color.ui=always", "status"],
  });
  assert.deepEqual(getSpawnCommand("node", ["-v"]), {
    command: "node",
    args: ["-v"],
  });
});

test("executeCommand returns the child exit code and forwards stderr", async () => {
  const stdout = captureStream();
  const stderr = captureStream();

  const exitCode = await executeCommand(
    "node",
    ["-e", "process.stderr.write('bad'); process.exit(7)"],
    { stdout: stdout.stream, stderr: stderr.stream },
  );

  assert.equal(exitCode, 7);
  assert.equal(stdout.output(), "");
  assert.equal(stderr.output(), "bad");
});
