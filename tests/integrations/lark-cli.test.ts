import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runLarkCli } from "../../src/integrations/lark-cli.js";

test("runLarkCli runs arbitrary lark-cli args", async () => {
  const calls: Array<{ command: string; args: string[]; hasOutputCallback: boolean }> = [];
  const chunks: Array<{ stream: "stdout" | "stderr"; text: string }> = [];

  const result = await runLarkCli(["docs", "+search", "--query", "git"], {
    onOutput(chunk) {
      chunks.push(chunk);
    },
    runner: {
      run: async (command, args, options) => {
        calls.push({ command, args, hasOutputCallback: Boolean(options?.onOutput) });
        options?.onOutput?.({ stream: "stdout", text: '{"ok":true}' });
        return { exitCode: 0, stdout: '{"ok":true}', stderr: "" };
      },
    },
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [
    {
      command: "lark-cli",
      args: ["docs", "+search", "--query", "git"],
      hasOutputCallback: true,
    },
  ]);
  assert.deepEqual(chunks, [{ stream: "stdout", text: '{"ok":true}' }]);
});

test("runLarkCli reports missing lark-cli install hint", async () => {
  await assert.rejects(
    () =>
      runLarkCli(["auth", "status"], {
        runner: {
          run: async () => {
            const error = new Error("spawn lark-cli ENOENT") as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
          },
        },
      }),
    /未检测到 lark-cli[\s\S]*npm install -g @larksuite\/cli/,
  );
});

test("runLarkCli aborts a spawned lark-cli process", async () => {
  const binDir = await mkdtemp(join(tmpdir(), "gitx-lark-cli-"));
  const shimPath = join(binDir, "lark-cli");
  await writeFile(
    shimPath,
    [
      "#!/usr/bin/env node",
      "setTimeout(() => {",
      "  process.stdout.write('finished\\n');",
      "  process.exit(0);",
      "}, 200);",
    ].join("\n"),
    "utf8",
  );
  await chmod(shimPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${previousPath ? `:${previousPath}` : ""}`;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  try {
    await assert.rejects(
      () => runLarkCli(["auth", "status"], { signal: controller.signal }),
      /aborted|abort/i,
    );
  } finally {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  }
});
