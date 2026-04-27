import type {
  CommandAgent,
  CommandAgentOutput,
  CommandContext,
  CommandResult,
} from "./types.js";

export type CommandOrchestrator = {
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

export type CommandOrchestratorOptions = {
  commandAgent: CommandAgent;
};

export function createCommandOrchestrator({
  commandAgent,
}: CommandOrchestratorOptions): CommandOrchestrator {
  return {
    beforeRun(context) {
      return commandAgent.beforeRun?.(context);
    },
    afterSuccess(context, result) {
      return commandAgent.afterSuccess?.(context, result);
    },
    afterFail(context, result) {
      return commandAgent.afterFail?.(context, result);
    },
  };
}
