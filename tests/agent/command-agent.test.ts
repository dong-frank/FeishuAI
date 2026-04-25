import assert from "node:assert/strict";
import test from "node:test";

import { COMMAND_AGENT_TOOLS } from "../../src/agent/command-agent.js";

test("COMMAND_AGENT_TOOLS includes the tldr manual tool", () => {
  assert.equal(COMMAND_AGENT_TOOLS.length, 1);
  assert.equal(COMMAND_AGENT_TOOLS[0]?.name, "tldr_git_manual");
});
