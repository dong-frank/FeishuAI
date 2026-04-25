import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { executeCommand } from "../../src/commands/run.js";
import type { CommandAgent } from "../../src/agent/types.js";

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

test("executeCommand does not call beforeRun, afterSuccess, or afterFail hooks", async () => {
  const events: string[] = [];
  const agent: CommandAgent = {
    beforeRun(context) {
      events.push(`before:${context.command}`);
    },
    afterSuccess(context, result) {
      events.push(`success:${context.command}:${result.exitCode}`);
    },
    afterFail(context, result) {
      events.push(`failure:${context.command}:${result.exitCode}:${result.stderr}`);
    },
  };

  const stdout = captureStream();
  const stderr = captureStream();

  const exitCode = await executeCommand(
    "node",
    ["-e", "process.stdout.write('ok')"],
    { agent, stdout: stdout.stream, stderr: stderr.stream },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(events, []);
});
