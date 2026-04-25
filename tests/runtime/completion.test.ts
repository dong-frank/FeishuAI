import assert from "node:assert/strict";
import test from "node:test";

import { getCompletion } from "../../src/runtime/completion.js";

test("getCompletion suggests git subcommand suffix", () => {
  assert.deepEqual(getCompletion("git sta"), {
    completion: "git status",
    suffix: "tus",
  });
});

test("getCompletion does not suggest ambiguous git subcommands", () => {
  assert.equal(getCompletion("git pu"), undefined);
});

test("getCompletion keeps trailing args after completed subcommand", () => {
  assert.equal(getCompletion("git status --short"), undefined);
});
