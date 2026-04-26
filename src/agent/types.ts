import type { TuiSessionGitInfo } from "../runtime/tui-session.js";

export type CommandFailureContext = {
  count: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  occurredAt: string;
};

export type GitCommandStatsContext = {
  successCount: number;
  failures: CommandFailureContext[];
};

export type CommandContext = {
  cwd: string;
  command: string;
  args: string[];
  rawCommand: string;
  gitStats?: GitCommandStatsContext;
  gitRepository?: TuiSessionGitInfo;
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommitMessageContext = {
  cwd: string;
  status?: string;
  stagedDiff?: string;
  unstagedDiff?: string;
  recentCommits?: string[];
};

export type CommandAgent = {
  askForHelp?: (context: CommandContext) => string | Promise<string>;
  beforeRun?: (context: CommandContext) => string | void | Promise<string | void>;
  afterSuccess?: (
    context: CommandContext,
    result: CommandResult,
  ) => string | void | Promise<string | void>;
  afterFail?: (
    context: CommandContext,
    result: CommandResult,
  ) => void | Promise<void>;
  generateCommitMessage?: (
    context: CommitMessageContext,
  ) => string | Promise<string>;
};

export type LarkAuthContext = {
  cwd: string;
  intent?: string;
};

export type LarkDocSearchContext = {
  cwd: string;
  query: string;
  command?: string;
  rawCommand?: string;
  result?: CommandResult;
};

export type LarkMessageContext = {
  cwd: string;
  recipient?: string;
  message: string;
  summary?: string;
};

export type LarkAgent = {
  authorize: (context: LarkAuthContext) => Promise<string>;
  searchDocs: (context: LarkDocSearchContext) => Promise<string>;
  sendMessage: (context: LarkMessageContext) => Promise<string>;
};
