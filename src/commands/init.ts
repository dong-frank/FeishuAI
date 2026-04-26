import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";

import { runLarkCli } from "../integrations/lark-cli.js";

export type LarkDocCandidate = {
  title: string;
  url?: string;
  token?: string;
  type?: string;
};

export function createInitCommand(): Command {
  return new Command("init")
    .description("Initialize git-helper and select an organization Git guide")
    .action(async () => {
      try {
        const result = await runLarkCli([
          "docs",
          "+search",
          "--query",
          "git",
          "--page-size",
          "10",
          "--format",
          "json",
        ]);
        if (result.stderr) {
          process.stderr.write(result.stderr);
        }
        if (result.exitCode !== 0) {
          process.exitCode = result.exitCode;
          return;
        }

        const candidates = extractLarkDocCandidates(result.stdout);
        if (candidates.length === 0) {
          process.stdout.write("没有搜索到和 Git 相关的飞书文档。\n");
          return;
        }

        process.stdout.write(formatDocSelectionPrompt(candidates));
        const selectedIndex = await askForSelection(candidates.length);
        const selected = candidates[selectedIndex - 1];
        if (!selected) {
          process.exitCode = 1;
          return;
        }

        process.stdout.write(
          [
            "",
            `已选择：${selected.title}`,
            selected.url ? `链接：${selected.url}` : undefined,
            "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      }
    });
}

export function extractLarkDocCandidates(rawJson: string): LarkDocCandidate[] {
  const parsed = JSON.parse(rawJson) as unknown;
  const items = findArrayByKey(parsed, "items") ?? findArrayByKey(parsed, "docs") ?? [];

  return items
    .map((item) => normalizeCandidate(item))
    .filter((item): item is LarkDocCandidate => item !== undefined);
}

export function formatDocSelectionPrompt(candidates: LarkDocCandidate[]): string {
  const lines = [
    "搜索到以下可能的 Git 规范文档：",
    "",
    ...candidates.map((candidate, index) => {
      const type = candidate.type ? ` [${candidate.type}]` : "";
      const url = candidate.url ? `\n   ${candidate.url}` : "";
      return `${index + 1}. ${candidate.title}${type}${url}`;
    }),
    "",
    "请选择要作为组织 Git 规范文档的编号：",
  ];

  return `${lines.join("\n")} `;
}

async function askForSelection(max: number): Promise<number> {
  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = await rl.question("");
      const selected = Number.parseInt(answer, 10);
      if (Number.isInteger(selected) && selected >= 1 && selected <= max) {
        return selected;
      }

      process.stdout.write(`请输入 1-${max} 之间的编号：`);
    }
  } finally {
    rl.close();
  }
}

function normalizeCandidate(item: unknown): LarkDocCandidate | undefined {
  if (!isRecord(item)) {
    return undefined;
  }

  const title = pickString(item, ["title", "name", "title_highlighted"]);
  if (!title) {
    return undefined;
  }

  const candidate: LarkDocCandidate = { title };
  const url = pickString(item, ["url", "link", "doc_url"]);
  const token = pickString(item, ["token", "doc_token", "document_id"]);
  const type = pickString(item, ["doc_type", "type", "obj_type"]);

  if (url) {
    candidate.url = url;
  }
  if (token) {
    candidate.token = token;
  }
  if (type) {
    candidate.type = type;
  }

  return candidate;
}

function findArrayByKey(value: unknown, key: string): unknown[] | undefined {
  if (Array.isArray(value)) {
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const found = value[key];
  if (Array.isArray(found)) {
    return found;
  }

  for (const nested of Object.values(value)) {
    const nestedFound = findArrayByKey(nested, key);
    if (nestedFound) {
      return nestedFound;
    }
  }

  return undefined;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
