import type {
  TuiSessionGitInfo,
  TuiSessionHeaderDisplay,
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

export type CommandChatContext = CommandContext & {
  message: string;
};

export type CommandTuiSessionContext = {
  cwd: string;
  git: TuiSessionGitInfo;
  lark: TuiSessionLarkInfo;
  header: {
    cwd: string;
    gitSummary: string;
    larkSummary: string;
    display: TuiSessionHeaderDisplay;
  };
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type AgentTokenUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens: number;
};

export type AgentContextUsage = {
  messageCount: number;
  characterCount: number;
  estimatedTokens: number;
};

export type AgentRunMetadata = {
  durationMs: number;
  tokenUsage?: AgentTokenUsage;
  contextUsage?: AgentContextUsage;
  rawToolCalls?: unknown[];
  rawAgentResult?: string;
};

export type AgentToolProgressEvent = {
  id: string;
  toolName: string;
  agentKind?: "command" | "lark" | undefined;
  state: "running" | "success" | "failed";
  displayText?: string | undefined;
  inputSummary?: string | undefined;
  durationMs?: number | undefined;
  error?: string | undefined;
};

export type AgentToolProgressHandler = (event: AgentToolProgressEvent) => void;

export type CommandAgentOutput = {
  content: string;
  suggestedCommand?: string;
  metadata?: AgentRunMetadata;
};

export type AgentRunOptions = {
  signal?: AbortSignal;
};

export type CommandAgent = {
  chat?: (
    context: CommandChatContext,
    options?: AgentRunOptions,
  ) => CommandAgentOutput | void | Promise<CommandAgentOutput | void>;
  beforeRun?: (
    context: CommandContext,
    options?: AgentRunOptions,
  ) => CommandAgentOutput | void | Promise<CommandAgentOutput | void>;
  afterSuccess?: (
    context: CommandContext,
    result: CommandResult,
    options?: AgentRunOptions,
  ) => CommandAgentOutput | void | Promise<CommandAgentOutput | void>;
  afterFail?: (
    context: CommandContext,
    result: CommandResult,
    options?: AgentRunOptions,
  ) => CommandAgentOutput | void | Promise<CommandAgentOutput | void>;
};

export type LarkAuthContext = {
  cwd: string;
  intent?: string;
  projectHints?: LarkProjectHints;
};

export type LarkProjectHints = {
  cwdName?: string;
  gitRoot?: string;
  branch?: string;
  remoteUrl?: string;
  webUrl?: string;
  repositoryName?: string;
};

export type LarkContextTopic =
  | "commit_message_policy"
  | "branch_naming_policy"
  | "troubleshooting_reference"
  | "development_record_guidance";

export type LarkContextRequest = {
  cwd: string;
  topic: LarkContextTopic;
  reason: string;
  command?: string;
  rawCommand?: string;
  repository?: {
    root?: string;
    remoteUrl?: string;
    webUrl?: string;
  };
};

export type LarkContextPack = {
  topic: LarkContextTopic;
  content: string;
  freshness: "remembered" | "refreshed" | "missing";
  source?: {
    title?: string;
    url?: string;
    documentId?: string;
  };
  updatedAt?: string;
};

export type LarkMessageContext = {
  cwd: string;
  reason: string;
  recipient?: string;
  message: string;
  identity?: "bot" | "user";
  summary?: string;
};

export type LarkGetContextInteraction = LarkContextRequest & {
  action: "get_context";
};

export type LarkSendMessageInteraction = LarkMessageContext & {
  action: "send_message";
};

export type LarkMeetingContext = {
  action: "schedule_meeting";
  cwd: string;
  reason: string;
  title?: string;
  start?: string;
  end?: string;
  attendeeIds?: string[];
  description?: string;
  needsRoom?: boolean;
  roomHint?: string;
  rawRequest?: string;
  summary?: string;
};

export type LarkBaseRecordContext = {
  action: "write_base_record";
  cwd: string;
  reason: string;
  baseToken?: string;
  tableId?: string;
  recordId?: string;
  fields: Record<string, unknown>;
  target?: string;
  rawRequest?: string;
  summary?: string;
};

export type LarkDevelopmentRecordContext = {
  action: "write_development_record";
  cwd: string;
  reason: string;
  command?: string;
  rawCommand?: string;
  result?: CommandResult;
  repository?: {
    root?: string;
    remoteUrl?: string;
    webUrl?: string;
  };
};

export type LarkInteractionRequest =
  | LarkGetContextInteraction
  | LarkSendMessageInteraction
  | LarkMeetingContext
  | LarkBaseRecordContext
  | LarkDevelopmentRecordContext;

export type LarkInteractionResult = LarkContextPack | CommandAgentOutput;

export type LarkAgent = {
  authorize: (
    context: LarkAuthContext,
    options?: AgentRunOptions,
  ) => Promise<CommandAgentOutput>;
  interact: (
    context: LarkInteractionRequest,
    options?: AgentRunOptions,
  ) => Promise<LarkInteractionResult>;
};
