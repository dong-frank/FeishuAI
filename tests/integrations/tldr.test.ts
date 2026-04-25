import assert from "node:assert/strict";
import test from "node:test";

import { readTldrPage } from "../../src/integrations/tldr.js";

test("readTldrPage normalizes git subcommands to tldr page names", async () => {
  const result = await readTldrPage("git push", {
    run: async (command, args) => ({
      exitCode: 0,
      stdout: `${command} ${args.join(" ")}`,
      stderr: "",
    }),
  });

  assert.equal(result, "tldr git-push");
});

test("readTldrPage returns a readable message when tldr has no page", async () => {
  const result = await readTldrPage("git unknown", {
    run: async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "Page not found",
    }),
  });

  assert.match(result, /未找到 tldr 页面/);
  assert.match(result, /Page not found/);
});
