import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  findProjectRoot,
  getDefaultSkillRootDir,
  loadProjectEnv,
  parseDotEnv,
} from "../../src/runtime/project-root.js";

test("parseDotEnv supports common .env syntax", () => {
  const parsed = parseDotEnv(`
    # comment
    API_KEY=abc123
    MODEL="doubao\\nmodel"
    export BASE_URL='https://example.test/v1'
    INLINE=value # ignored comment
  `);

  assert.equal(parsed.API_KEY, "abc123");
  assert.equal(parsed.MODEL, "doubao\nmodel");
  assert.equal(parsed.BASE_URL, "https://example.test/v1");
  assert.equal(parsed.INLINE, "value");
});

test("loadProjectEnv loads project-root .env without overriding existing values", async () => {
  const root = await mkdtemp(join(tmpdir(), "git-helper-project-root-"));
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "git-helper" }));
  await writeFile(join(root, ".env"), "API_KEY=from-file\nMODEL=from-file\n");

  const moduleUrl = pathToFileURL(join(root, "dist", "index.js")).href;
  const env: NodeJS.ProcessEnv = { MODEL: "from-shell" };
  const result = loadProjectEnv(moduleUrl, env);

  assert.equal(findProjectRoot(moduleUrl), root);
  assert.equal(getDefaultSkillRootDir(moduleUrl), join(root, "skills"));
  assert.equal(env.API_KEY, "from-file");
  assert.equal(env.MODEL, "from-shell");
  assert.deepEqual(result.loadedKeys, ["API_KEY"]);
  assert.deepEqual(result.skippedKeys, ["MODEL"]);
  assert.equal(result.envPath, join(root, ".env"));
});
