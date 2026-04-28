import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createSkillRegistry,
  formatAvailableSkills,
} from "../../src/agent/skill-registry.js";

test("skill registry discovers local SKILL.md metadata and loads content", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "skills-"));
  const skillDir = join(rootDir, "lark-example");
  await mkdir(skillDir);
  await writeFile(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: lark-example",
      "version: 1.0.0",
      'description: "Example skill for tests."',
      "---",
      "",
      "# Example",
      "",
      "Use lark-cli safely.",
    ].join("\n"),
    { flush: true },
  );

  const registry = await createSkillRegistry({ rootDir });

  assert.deepEqual(registry.listSkills(), [
    {
      name: "lark-example",
      version: "1.0.0",
      description: "Example skill for tests.",
    },
  ]);
  assert.match(await registry.loadSkill("lark-example"), /Use lark-cli safely/);
  assert.match(formatAvailableSkills(registry.listSkills()), /lark-example: Example skill/);
});

test("skill registry rejects unknown skill names", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "skills-"));
  const registry = await createSkillRegistry({ rootDir });

  await assert.rejects(
    () => registry.loadSkill("../secret"),
    /Unknown skill/,
  );
});

test("skill registry ignores skills whose names do not start with lark-", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "skills-"));
  const larkSkillDir = join(rootDir, "lark-example");
  const otherSkillDir = join(rootDir, "weekly-cycle-report");
  await mkdir(larkSkillDir);
  await mkdir(otherSkillDir);
  await writeFile(
    join(larkSkillDir, "SKILL.md"),
    [
      "---",
      "name: lark-example",
      'description: "Lark example."',
      "---",
      "",
      "# Lark Example",
    ].join("\n"),
    { flush: true },
  );
  await writeFile(
    join(otherSkillDir, "SKILL.md"),
    [
      "---",
      "name: weekly-cycle-report",
      'description: "Not a Lark skill."',
      "---",
      "",
      "# Weekly Cycle Report",
    ].join("\n"),
    { flush: true },
  );

  const registry = await createSkillRegistry({ rootDir });

  assert.deepEqual(
    registry.listSkills().map((skill) => skill.name),
    ["lark-example"],
  );
  await assert.rejects(
    () => registry.loadSkill("weekly-cycle-report"),
    /Unknown skill/,
  );
});

test("skill registry can discover command skills with an explicit prefix", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "skills-"));
  const commandSkillDir = join(rootDir, "command-help");
  const larkSkillDir = join(rootDir, "lark-example");
  await mkdir(commandSkillDir);
  await mkdir(larkSkillDir);
  await writeFile(
    join(commandSkillDir, "SKILL.md"),
    [
      "---",
      "name: command-help",
      'description: "Command help routing skill."',
      "---",
      "",
      "# Command Help",
    ].join("\n"),
    { flush: true },
  );
  await writeFile(
    join(larkSkillDir, "SKILL.md"),
    [
      "---",
      "name: lark-example",
      'description: "Lark example."',
      "---",
      "",
      "# Lark Example",
    ].join("\n"),
    { flush: true },
  );

  const registry = await createSkillRegistry({
    rootDir,
    namePrefixes: ["command-"],
  });

  assert.deepEqual(
    registry.listSkills().map((skill) => skill.name),
    ["command-help"],
  );
  assert.match(await registry.loadSkill("command-help"), /Command Help/);
  await assert.rejects(
    () => registry.loadSkill("lark-example"),
    /Unknown skill/,
  );
});

test("skill registry discovers lark-authorize skills", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "skills-"));
  const skillDir = join(rootDir, "lark-authorize");
  await mkdir(skillDir);
  await writeFile(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: lark-authorize",
      'description: "Authorize lark-cli."',
      "---",
      "",
      "# Lark Authorize",
      "",
      "Always run lark-cli auth status first.",
    ].join("\n"),
    { flush: true },
  );

  const registry = await createSkillRegistry({ rootDir });

  assert.deepEqual(
    registry.listSkills().map((skill) => skill.name),
    ["lark-authorize"],
  );
  assert.match(
    await registry.loadSkill("lark-authorize"),
    /auth status first/,
  );
});
