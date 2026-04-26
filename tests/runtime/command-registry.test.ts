import assert from "node:assert/strict";
import test from "node:test";

import { classifyCommand } from "../../src/runtime/command-registry.js";

test("classifyCommand identifies git commands", () => {
  assert.equal(classifyCommand({ command: "git", args: ["status"] }).kind, "git");
  assert.equal(classifyCommand({ command: "git", args: ["push"] }).kind, "git");
});

test("classifyCommand treats every git subcommand as a git command", () => {
  assert.deepEqual(classifyCommand({ command: "git", args: ["daemon"] }), {
    kind: "git",
    subcommand: "daemon",
  });
  assert.deepEqual(classifyCommand({ command: "git", args: ["worktree", "list"] }), {
    kind: "git",
    subcommand: "worktree",
  });
  assert.deepEqual(classifyCommand({ command: "git", args: ["--version"] }), {
    kind: "git",
    subcommand: "--version",
  });
});

test("classifyCommand identifies custom commands", () => {
  assert.equal(classifyCommand({ command: "lark", args: ["status"] }).kind, "custom");
});

test("classifyCommand identifies non-git external commands", () => {
  assert.deepEqual(classifyCommand({ command: "ls", args: [] }), {
    kind: "other",
    reason: "External command: ls",
  });
});
