import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("getCompletion suggests a unique filesystem path after a git subcommand", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "git-helper-completion-"));
  await mkdir(join(cwd, "src"));

  assert.deepEqual(await getCompletion("git add sr", cwd), {
    completion: "git add src",
    suffix: "c",
  });
});

test("getCompletion suggests nested filesystem paths", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "git-helper-completion-"));
  await mkdir(join(cwd, "src"));
  await writeFile(join(cwd, "src", "runtime.ts"), "", "utf8");

  assert.deepEqual(await getCompletion("git add src/ru", cwd), {
    completion: "git add src/runtime.ts",
    suffix: "ntime.ts",
  });
});

test("getCompletion does not suggest ambiguous filesystem paths", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "git-helper-completion-"));
  await writeFile(join(cwd, "src-a.ts"), "", "utf8");
  await writeFile(join(cwd, "src-b.ts"), "", "utf8");

  assert.equal(await getCompletion("git add sr", cwd), undefined);
});
