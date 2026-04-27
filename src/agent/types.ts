import type {
  TuiSessionGitInfo,
  TuiSessionLarkInfo,
} from "../runtime/tui-session.js";

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
  tuiSession?: CommandTuiSessionContext;
};

export type CommandTuiSessionContext = {
  cwd: string;
  git: TuiSessionGitInfo;
  lark: TuiSessionLarkInfo;
  header: {
    cwd: string;
    gitSummary: string;
    larkSummary: string;
  };
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type AgentTokenUsage = {
  totalTokens: number;
};

export type AgentRunMetadata = {
  durationMs: number;
  tokenUsage?: AgentTokenUsage;
};

export type CommandAgentSupplementalLookup =
  | {
      type: "lark.docs";
      query: string;
      reason: string;
      displayHint?:
        | "append_as_team_policy"
        | "append_as_troubleshooting_reference"
        | undefined;
    };

export type CommandAgentFollowUpAction =
  | {
      type: "collaboration.notification";
      reason: string;
      title: string;
      draftMessage: string;
      confirmationMode: "explicit_followup";
    };

export type CommandAgentOutput = {
  content: string;
  suggestedCommand?: string;
  supplementalLookups?: CommandAgentSupplementalLookup[];
  followUpActions?: CommandAgentFollowUpAction[];
  metadata?: AgentRunMetadata;
};

export type CommandAgent = {
  beforeRun?: (
    context: CommandContext,
  ) => CommandAgentOutput | void | Promise<CommandAgentOutput | void>;
  afterSuccess?: (
    context: CommandContext,
    result: CommandResult,
  ) => CommandAgentOutput | void | Promise<CommandAgentOutput | void>;
  afterFail?: (
    context: CommandContext,
    result: CommandResult,
  ) => CommandAgentOutput | void | Promise<CommandAgentOutput | void>;
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
  authorize: (context: LarkAuthContext) => Promise<CommandAgentOutput>;
  searchDocs: (context: LarkDocSearchContext) => Promise<CommandAgentOutput>;
  sendMessage: (context: LarkMessageContext) => Promise<CommandAgentOutput>;
};
