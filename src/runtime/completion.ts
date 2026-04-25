import { SUPPORTED_GIT_SUBCOMMANDS } from "./command-registry.js";

export type CommandCompletion = {
  completion: string;
  suffix: string;
};

export function getCompletion(input: string): CommandCompletion | undefined {
  const hasTrailingSpace = /\s$/.test(input);
  const parts = input.trimStart().split(/\s+/).filter(Boolean);
  if (hasTrailingSpace || parts.length !== 2 || parts[0] !== "git") {
    return undefined;
  }

  const partial = parts[1];
  if (!partial) {
    return undefined;
  }

  const matches = SUPPORTED_GIT_SUBCOMMANDS.filter((subcommand) =>
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
