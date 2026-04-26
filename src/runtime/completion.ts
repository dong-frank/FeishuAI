import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { COMMON_GIT_SUBCOMMANDS } from "./command-registry.js";

export type CommandCompletion = {
  completion: string;
  suffix: string;
};

export function getCompletion(
  input: string,
  cwd: string = process.cwd(),
): CommandCompletion | undefined {
  const hasTrailingSpace = /\s$/.test(input);
  const parts = input.trimStart().split(/\s+/).filter(Boolean);
  if (hasTrailingSpace || parts[0] !== "git") {
    return undefined;
  }

  if (parts.length > 2) {
    return getPathCompletion(input, cwd, parts);
  }

  if (parts.length !== 2) {
    return undefined;
  }

  const partial = parts[1];
  if (!partial) {
    return undefined;
  }

  const matches = COMMON_GIT_SUBCOMMANDS.filter((subcommand) =>
    subcommand.startsWith(partial),
  );

  if (matches.length !== 1) {
    return undefined;
  }

  const match = matches[0];
  if (!match || match === partial) {
    return undefined;
  }

  return {
    completion: `git ${match}`,
    suffix: match.slice(partial.length),
  };
}

function getPathCompletion(
  input: string,
  cwd: string,
  parts: string[],
): CommandCompletion | undefined {
  const partialPath = parts.at(-1);
  if (!partialPath) {
    return undefined;
  }

  const directoryPart = dirname(partialPath);
  const searchDirectory = directoryPart === "." ? "" : directoryPart;
  const partialName = basename(partialPath);
  const entries = readDirectoryEntries(join(cwd, searchDirectory));
  const matches = entries.filter((entry) => entry.startsWith(partialName));
  if (matches.length !== 1) {
    return undefined;
  }

  const match = matches[0];
  if (!match || match === partialName) {
    return undefined;
  }

  const completedPath = searchDirectory ? `${searchDirectory}/${match}` : match;
  const completion = `${input.slice(0, input.length - partialPath.length)}${completedPath}`;

  return {
    completion,
    suffix: completedPath.slice(partialPath.length),
  };
}

function readDirectoryEntries(directory: string) {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}
