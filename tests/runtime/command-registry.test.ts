import assert from "node:assert/strict";
import test from "node:test";

import { classifyCommand } from "../../src/runtime/command-registry.js";

test("classifyCommand identifies supported git commands", () => {
  assert.equal(classifyCommand({ command: "git", args: ["status"] }).kind, "git");
  assert.equal(classifyCommand({ command: "git", args: ["push"] }).kind, "git");
});

test("classifyCommand identifies unsupported git subcommands as other", () => {
  assert.deepEqual(classifyCommand({ command: "git", args: ["daemon"] }), {
    kind: "other",
    reason: "Unsupported git subcommand: daemon",
  });
});

test("classifyCommand identifies custom commands", () => {
  assert.equal(classifyCommand({ command: "init", args: [] }).kind, "custom");
  assert.equal(classifyCommand({ command: "lark", args: ["status"] }).kind, "custom");
});

test("classifyCommand identifies non-git external commands", () => {
  assert.deepEqual(classifyCommand({ command: "ls", args: [] }), {
    kind: "other",
    reason: "External command: ls",
  });
});
