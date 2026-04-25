import assert from "node:assert/strict";
import test from "node:test";

import {
  getLarkCliInstallHint,
  loginLarkCli,
  runLarkCli,
  searchLarkDocs,
  setupLarkCli,
  statusLarkCli,
  streamLarkCli,
} from "../../src/integrations/lark-cli.js";

test("statusLarkCli runs lark-cli auth status", async () => {
  const calls: string[][] = [];

  await statusLarkCli({
    run: async (_command, args) => {
      calls.push(args);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.deepEqual(calls, [["auth", "status"]]);
});

test("setupLarkCli runs lark-cli config init --new", async () => {
  const calls: string[][] = [];

  await setupLarkCli({
    run: async (_command, args) => {
      calls.push(args);
      return { exitCode: 0, stdout: "setup", stderr: "" };
    },
  });

  assert.deepEqual(calls, [["config", "init", "--new"]]);
});

test("loginLarkCli runs lark-cli auth login --recommend", async () => {
  const calls: string[][] = [];

  await loginLarkCli({
    run: async (_command, args) => {
      calls.push(args);
      return { exitCode: 0, stdout: "login", stderr: "" };
    },
  });

  assert.deepEqual(calls, [["auth", "login", "--recommend"]]);
});

test("runLarkCli reports missing lark-cli install hint", async () => {
  await assert.rejects(
    () =>
      runLarkCli(["auth", "status"], {
        run: async () => {
          const error = new Error("spawn lark-cli ENOENT") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        },
      }),
    /未检测到 lark-cli/,
  );

  assert.match(getLarkCliInstallHint(), /npm install -g @larksuite\/cli/);
});

test("streamLarkCli streams through the provided runner", async () => {
  const calls: string[][] = [];

  const result = await streamLarkCli(["config", "init", "--new"], {
    run: async (_command, args) => {
      calls.push(args);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [["config", "init", "--new"]]);
});

test("searchLarkDocs searches docs with query, page size, and json format", async () => {
  const calls: string[][] = [];

  await searchLarkDocs("git", {
    run: async (_command, args) => {
      calls.push(args);
      return { exitCode: 0, stdout: '{"ok":true}', stderr: "" };
    },
  });

  assert.deepEqual(calls, [
    ["docs", "+search", "--query", "git", "--page-size", "10", "--format", "json"],
  ]);
});
