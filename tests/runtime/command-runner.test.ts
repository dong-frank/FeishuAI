import assert from "node:assert/strict";
import test from "node:test";

import { parseCommandLine, runCommandLine } from "../../src/runtime/command-runner.js";

test("parseCommandLine splits command and args", () => {
  assert.deepEqual(parseCommandLine("git status --short"), {
    command: "git",
    args: ["status", "--short"],
  });
});

test("parseCommandLine returns undefined for blank input", () => {
  assert.equal(parseCommandLine("   "), undefined);
});

test("parseCommandLine marks trailing question mark as help request", () => {
  assert.deepEqual(parseCommandLine("git push ?"), {
    command: "git",
    args: ["push"],
    helpRequested: true,
  });
});

test("runCommandLine calls askForHelp and does not execute command for help requests", async () => {
  const events: string[] = [];

  const result = await runCommandLine("node -e process.exit(9) ?", {
    agent: {
      askForHelp(context) {
        events.push(`help:${context.rawCommand}`);
      },
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.kind, "help");
  assert.deepEqual(events, ["help:node -e process.exit(9)"]);
});
