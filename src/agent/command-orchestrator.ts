import type {
  CommandAgent,
  CommandAgentOutput,
  CommandContext,
  CommandResult,
  LarkAgent,
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
  larkAgent?: Pick<LarkAgent, "searchDocs">;
};

export function createCommandOrchestrator({
  commandAgent,
  larkAgent,
}: CommandOrchestratorOptions): CommandOrchestrator {
  return {
    async beforeRun(context) {
      return resolveSupplementalLookups(
        await commandAgent.beforeRun?.(context),
        context,
        undefined,
        larkAgent,
      );
    },
    async afterSuccess(context, result) {
      return resolveSupplementalLookups(
        await commandAgent.afterSuccess?.(context, result),
        context,
        result,
        larkAgent,
      );
    },
    async afterFail(context, result) {
      return resolveSupplementalLookups(
        await commandAgent.afterFail?.(context, result),
        context,
        result,
        larkAgent,
      );
    },
  };
}

async function resolveSupplementalLookups(
  output: CommandAgentOutput | void | undefined,
  context: CommandContext,
  result: CommandResult | undefined,
  larkAgent: Pick<LarkAgent, "searchDocs"> | undefined,
): Promise<CommandAgentOutput | void> {
  if (!output || !larkAgent || !output.supplementalLookups?.length) {
    return output;
  }

  const larkDocLookups = output.supplementalLookups.filter(
    (lookup) => lookup.type === "lark.docs",
  );
  if (larkDocLookups.length === 0) {
    return output;
  }

  const lookupResults = await Promise.all(
    larkDocLookups.map((lookup) =>
      larkAgent.searchDocs({
        cwd: context.cwd,
        query: lookup.query,
        command: context.command,
        rawCommand: context.rawCommand,
        ...(result ? { result } : {}),
        reason: lookup.reason,
        ...(lookup.displayHint ? { displayHint: lookup.displayHint } : {}),
      }),
    ),
  );

  const lookupContent = lookupResults
    .map((lookupResult) => lookupResult.content.trim())
    .filter(Boolean)
    .join("\n\n");
  if (!lookupContent) {
    return output;
  }

  return {
    ...output,
    content: `${output.content}\n\n团队资料：\n${lookupContent}`,
  };
}
