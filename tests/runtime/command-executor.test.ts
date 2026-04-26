import assert from "node:assert/strict";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("executeCommand runs a command in the provided cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "git-helper-executor-"));
  const stdout = captureStream();
  const stderr = captureStream();

  const exitCode = await executeCommand(
    "node",
    ["-e", "process.stdout.write(process.cwd())"],
    { cwd, stdout: stdout.stream, stderr: stderr.stream },
  );

  assert.equal(exitCode, 0);
  assert.equal(await realpath(stdout.output()), await realpath(cwd));
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

test("executeCommand reports missing commands like a shell command-not-found failure", async () => {
  const stdout = captureStream();
  const stderr = captureStream();

  const exitCode = await executeCommand(
    "git-helper-command-that-does-not-exist",
    [],
    { stdout: stdout.stream, stderr: stderr.stream },
  );

  assert.equal(exitCode, 127);
  assert.equal(stdout.output(), "");
  assert.equal(stderr.output(), "command not found: git-helper-command-that-does-not-exist\n");
});
