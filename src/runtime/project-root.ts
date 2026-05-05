import { existsSync, readFileSync } from "node:fs";
import { realpath as realpathAsync, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type EnvLoadResult = {
  envPath: string | undefined;
  loadedKeys: string[];
  skippedKeys: string[];
};

export function findProjectRoot(moduleUrl: string): string {
  let current = dirname(fileURLToPath(moduleUrl));

  for (;;) {
    const packageJsonPath = join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
          name?: string;
        };
        if (packageJson.name === "git-helper") {
          return current;
        }
      } catch {
        // Keep walking upward; a malformed parent package should not break startup.
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return dirname(fileURLToPath(moduleUrl));
    }
    current = parent;
  }
}

export function getProjectEnvPath(moduleUrl: string): string {
  return join(findProjectRoot(moduleUrl), ".env");
}

export function getDefaultSkillRootDir(moduleUrl: string): string {
  return join(findProjectRoot(moduleUrl), "skills");
}

export async function resolveProjectStateRoot(cwd: string) {
  const start = await realpathAsync(cwd).catch(() => cwd);
  let current = start;

  while (true) {
    if (await pathExists(join(current, ".git"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return cwd;
    }
    current = parent;
  }
}

export function parseDotEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const line = trimmedLine.startsWith("export ")
      ? trimmedLine.slice("export ".length).trimStart()
      : trimmedLine;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    values[key] = parseDotEnvValue(line.slice(separatorIndex + 1).trim());
  }

  return values;
}

export function loadProjectEnv(
  moduleUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): EnvLoadResult {
  const envPath = getProjectEnvPath(moduleUrl);
  if (!existsSync(envPath)) {
    return { envPath: undefined, loadedKeys: [], skippedKeys: [] };
  }

  const loadedKeys: string[] = [];
  const skippedKeys: string[] = [];
  const values = parseDotEnv(readFileSync(envPath, "utf8"));

  for (const [key, value] of Object.entries(values)) {
    if (env[key] !== undefined) {
      skippedKeys.push(key);
      continue;
    }

    env[key] = value;
    loadedKeys.push(key);
  }

  return {
    envPath: resolve(envPath),
    loadedKeys,
    skippedKeys,
  };
}

function parseDotEnvValue(value: string): string {
  if (!value) {
    return "";
  }

  const quote = value[0];
  if (quote === `"` || quote === `'`) {
    const closingIndex = findClosingQuote(value, quote);
    const quotedValue = closingIndex === -1 ? value.slice(1) : value.slice(1, closingIndex);
    return quote === `"` ? unescapeDoubleQuotedValue(quotedValue) : quotedValue;
  }

  return value.replace(/\s+#.*$/, "").trim();
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function findClosingQuote(value: string, quote: string): number {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === quote && value[index - 1] !== "\\") {
      return index;
    }
  }

  return -1;
}

function unescapeDoubleQuotedValue(value: string): string {
  return value.replace(/\\([nrt"\\])/g, (_, escaped: string) => {
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return escaped;
    }
  });
}
