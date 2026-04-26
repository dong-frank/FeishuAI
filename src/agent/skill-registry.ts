import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type SkillMetadata = {
  name: string;
  version?: string;
  description: string;
};

export type SkillRegistry = {
  listSkills: () => SkillMetadata[];
  loadSkill: (skillName: string) => Promise<string>;
};

export type SkillRegistryOptions = {
  rootDir: string;
};

type SkillRecord = SkillMetadata & {
  filePath: string;
};

export function createSkillRegistry(options: SkillRegistryOptions): SkillRegistry {
  const skills = discoverSkills(options.rootDir);

  return {
    listSkills() {
      return skills.map(({ name, version, description }) => ({
        name,
        ...(version ? { version } : {}),
        description,
      }));
    },
    async loadSkill(skillName: string) {
      const skill = skills.find((candidate) => candidate.name === skillName);
      if (!skill) {
        throw new Error(`Unknown skill: ${skillName}`);
      }

      return readFileSync(skill.filePath, "utf8");
    },
  };
}

export function formatAvailableSkills(skills: SkillMetadata[]): string {
  if (skills.length === 0) {
    return "No skills found.";
  }

  return skills
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join("\n");
}

function discoverSkills(rootDir: string): SkillRecord[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  return readdirSync(rootDir)
    .map((entry) => join(rootDir, entry))
    .filter((entryPath) => statSync(entryPath).isDirectory())
    .map((skillDir) => join(skillDir, "SKILL.md"))
    .filter((skillPath) => existsSync(skillPath))
    .map(readSkillRecord)
    .filter((skill) => skill.name.startsWith("lark-"))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function readSkillRecord(filePath: string): SkillRecord {
  const content = readFileSync(filePath, "utf8");
  const frontmatter = parseFrontmatter(content);
  const name = frontmatter.name;
  const description = frontmatter.description;

  if (!name || !description) {
    throw new Error(`Skill ${filePath} must include name and description frontmatter`);
  }

  return {
    name,
    ...(frontmatter.version ? { version: frontmatter.version } : {}),
    description,
    filePath,
  };
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n(?<body>[\s\S]*?)\n---/);
  const body = match?.groups?.body;
  if (!body) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const field = line.match(/^(?<key>[A-Za-z0-9_-]+):\s*(?<value>.*)$/);
    const key = field?.groups?.key;
    const value = field?.groups?.value;
    if (!key || value === undefined) {
      continue;
    }

    result[key] = unquoteFrontmatterValue(value.trim());
  }

  return result;
}

function unquoteFrontmatterValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
