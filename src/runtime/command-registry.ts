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

export const SUPPORTED_GIT_SUBCOMMANDS = [
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

const SUPPORTED_GIT_SUBCOMMAND_SET = new Set(SUPPORTED_GIT_SUBCOMMANDS);

const SUPPORTED_CUSTOM_COMMANDS = new Set(["init", "lark", "help", "exit", "quit"]);

export function classifyCommand(parsed: ParsedCommandLine): CommandClassification {
  if (parsed.command === "git") {
    const subcommand = parsed.args[0];
    if (!subcommand) {
      return {
        kind: "git",
        subcommand: "help",
      };
    }

    if (SUPPORTED_GIT_SUBCOMMAND_SET.has(subcommand as (typeof SUPPORTED_GIT_SUBCOMMANDS)[number])) {
      return {
        kind: "git",
        subcommand,
      };
    }

    return {
      kind: "other",
      reason: `Unsupported git subcommand: ${subcommand}`,
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
