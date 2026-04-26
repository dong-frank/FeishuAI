import type { ParsedCommandLine } from "./command-runner.js";

export type CommandKind = "git" | "custom" | "other";

export type CommandClassification =
  | {
      kind: "git";
      subcommand: string;
    }
  | {
      kind: "custom";
      name: string;
    }
  | {
      kind: "other";
      reason: string;
    };

export const COMMON_GIT_SUBCOMMANDS = [
  "add",
  "branch",
  "checkout",
  "clone",
  "commit",
  "diff",
  "fetch",
  "log",
  "merge",
  "pull",
  "push",
  "rebase",
  "restore",
  "status",
  "switch",
] as const;

const SUPPORTED_CUSTOM_COMMANDS = new Set([
  "cd",
  "git-helper",
  "help",
  "lark",
  "exit",
  "quit",
]);

export function classifyCommand(parsed: ParsedCommandLine): CommandClassification {
  if (parsed.command === "git") {
    const subcommand = parsed.args[0];
    if (!subcommand) {
      return {
        kind: "git",
        subcommand: "help",
      };
    }

    return {
      kind: "git",
      subcommand,
    };
  }

  if (SUPPORTED_CUSTOM_COMMANDS.has(parsed.command)) {
    return {
      kind: "custom",
      name: parsed.command,
    };
  }

  return {
    kind: "other",
    reason: `External command: ${parsed.command}`,
  };
}
