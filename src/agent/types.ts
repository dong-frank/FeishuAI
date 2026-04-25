export type CommandContext = {
  cwd: string;
  command: string;
  args: string[];
  rawCommand: string;
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandAgent = {
  askForHelp?: (context: CommandContext) => string | Promise<string>;
  beforeRun?: (context: CommandContext) => void | Promise<void>;
  afterSuccess?: (
    context: CommandContext,
    result: CommandResult,
  ) => void | Promise<void>;
  afterFail?: (
    context: CommandContext,
    result: CommandResult,
  ) => void | Promise<void>;
};
