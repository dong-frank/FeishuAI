# GITX 核心代码说明

本文档记录本项目的核心代码，重点包括 Agent 部分和 TUI 部分。

## 一、Agent 核心代码

Agent 部分采用双 Agent 设计：

- `Linus`：Git 工作流 Agent，负责命令帮助、commit message、成功建议、失败诊断。
- `Friday`：飞书协作 Agent，负责飞书授权、查询飞书文档、写开发记录、发消息、预约会议、更新多维表格。

### 1. Agent 接口定义

文件：`src/agent/types.ts`

```ts
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
```

这段代码定义了 TUI 和 Agent 之间的稳定接口。TUI 不需要关心底层是否使用 LangChain，只需要调用 `beforeRun`、`afterSuccess`、`afterFail` 和 `chat`。

### 2. Linus 的任务路由

文件：`src/agent/command-agent.ts`

```ts
export const COMMAND_AGENT_TASK_SKILLS = {
  help: "command-help",
  commitMessage: "command-git-commit-message",
  afterFail: "command-after-fail",
  afterSuccess: "command-after-success",
  chat: "command-chat",
} as const;

export function routeCommandAgentTask(context: {
  command: string;
  args: string[];
}): CommandAgentTaskName {
  return context.command === "git" && context.args[0] === "commit"
    ? "commitMessage"
    : "help";
}
```

Linus 的能力不是自由调用的，而是由系统根据命令生命周期固定路由到不同 Skill。比如 `git commit` 会进入 `commitMessage`，普通命令帮助会进入 `help`。

### 3. Linus 调用 Friday 的受控工具

文件：`src/agent/command-agent.ts`

```ts
export function createInteractWithLarkAgentTool({
  larkAgent,
  allowedActions,
}: InteractWithLarkAgentToolOptions = {}): StructuredToolInterface {
  const allowedActionSet = new Set<LarkInteractionAction>(
    allowedActions ?? [
      "get_context",
      "send_message",
      "schedule_meeting",
      "write_base_record",
      "write_development_record",
    ],
  );

  return withTuiDisplay(
    tool(
      async (input) => {
        if (!allowedActionSet.has(input.action)) {
          throw new Error(
            `Lark action ${input.action} is not allowed for this command task.`,
          );
        }

        if (!larkAgent) {
          return JSON.stringify({
            content: "未配置 Friday，飞书动作未执行。",
          });
        }

        return JSON.stringify(await larkAgent.interact(normalizeLarkInteractionInput(input)));
      },
      {
        name: "interact_with_lark_agent",
        description: "与 Friday 执行受控交互。只接受固定交互参数，不接受 lark-cli args。",
        schema: createInteractWithLarkAgentSchema(allowedActionSet),
      },
    ),
    "请求 Friday",
  );
}
```

这段代码体现了安全边界：Linus 不能直接执行飞书 CLI，只能通过固定 action 请求 Friday，避免 Agent 越权操作。

### 4. Git 上下文读取工具

文件：`src/agent/command-agent.ts`

```ts
export async function buildGitCommitContext({
  cwd,
  runGitCommand = runGit,
}: GitCommitContextOptions) {
  const [status, stagedDiff, recentCommits] = await Promise.all([
    runGitCommand(["status", "--short"], cwd),
    runGitCommand(["diff", "--cached"], cwd),
    runGitCommand(["log", "-5", "--pretty=%s"], cwd),
  ]);

  return {
    status: formatGitOutput("git status --short", status, GIT_COMMIT_CONTEXT_SUMMARY_LIMIT),
    stagedDiff: formatGitOutput("git diff --cached", stagedDiff, GIT_COMMIT_CONTEXT_DIFF_LIMIT),
    recentCommits: formatGitOutput(
      "git log -5 --pretty=%s",
      recentCommits,
      GIT_COMMIT_CONTEXT_SUMMARY_LIMIT,
    ),
  };
}
```

生成 commit message 时，Agent 会读取真实 staged diff、git status 和最近提交记录，而不是凭空生成。

### 5. Friday 的飞书动作路由

文件：`src/agent/lark-agent.ts`

```ts
export const LARK_AGENT_INTERACTION_SKILLS = {
  get_context: "lark-doc-lookup",
  send_message: "lark-im",
  schedule_meeting: "lark-calendar",
  write_base_record: "lark-base",
  write_development_record: "lark-doc-write",
} as const;

export function formatLarkAgentInvocation(
  task: "authorize" | "interact",
  context: LarkAuthContext | LarkInteractionRequest,
  memory?: AgentMemoryHint,
) {
  const invocation: LarkAgentInvocation =
    task === "authorize"
      ? {
          task,
          skill: LARK_AGENT_TASK_SKILLS.authorize,
          context: context as LarkAuthContext,
          ...(memory ? { memory } : {}),
        }
      : {
          task,
          skill: LARK_AGENT_INTERACTION_SKILLS[
            (context as LarkInteractionRequest).action
          ],
          context: context as LarkInteractionRequest,
          ...(memory ? { memory } : {}),
        };
  return JSON.stringify(invocation);
}
```

Friday 会把不同飞书动作路由到不同 Skill，例如查询文档、发送消息、更新 Base、写开发记录等。

### 6. Friday 执行 lark-cli

文件：`src/agent/lark-agent.ts`

```ts
export function createRunLarkCliTool(
  options: LarkAgentOptions = {},
): StructuredToolInterface {
  return withTuiDisplay(
    tool(
      async ({ args, showOutputInTui = false }, runtime?: ToolRuntime) => {
        const executeRunLarkCli = options.runLarkCli ?? runLarkCli;
        const signal = readAbortSignal(runtime);
        const result = await executeRunLarkCli(args, {
          ...(showOutputInTui && options.onLarkCliOutput
            ? { onOutput: options.onLarkCliOutput }
            : {}),
          ...(signal ? { signal } : {}),
        });
        return formatLarkCliResult(result);
      },
      {
        name: "run_lark_cli",
        description: "执行任意 lark-cli 命令参数。args 不包含 lark-cli 本身。",
        schema: z.object({
          args: z.array(z.string()),
          showOutputInTui: z.boolean().default(false),
        }),
      },
    ),
    "执行 Lark CLI",
  );
}
```

Friday 是唯一可以调用 `lark-cli` 的 Agent，并且工具参数被限制为数组形式，避免直接执行任意 shell 命令。

## 二、TUI 核心代码

TUI 使用 Ink + React 实现，是用户主要交互入口。它负责输入、补全、命令执行、历史展示、Agent 状态展示，以及在命令生命周期中触发 Agent。

### 1. TUI 创建 Linus 和 Friday

文件：`src/tui/app.tsx`

```tsx
if (!larkAgent.current) {
  larkAgent.current = createLarkAgent({
    onLarkCliOutput(chunk) {
      larkOutputHandler.current?.(chunk);
    },
    onToolProgress(event) {
      agentToolProgressHandler.current?.(event);
    },
    onContextUsage(usage) {
      rememberAgentContextUsageValue("lark", usage);
    },
  });
}

if (!commandAgent.current) {
  commandAgent.current = createCommandAgent({
    larkAgent: larkAgent.current,
    onToolProgress(event) {
      agentToolProgressHandler.current?.(event);
    },
    onContextUsage(usage) {
      rememberAgentContextUsageValue("command", usage);
    },
  });
}
```

TUI 启动时创建两个 Agent，并把 Friday 注入 Linus，让 Linus 在需要飞书上下文时可以通过受控方式请求 Friday。

### 2. 键盘输入处理

文件：`src/tui/app.tsx`

```tsx
useInput((character, key) => {
  if (key.ctrl && character === "c") {
    if (getCtrlCAction({
      hasActiveAgent: Boolean(activeAgentRun.current),
      isAgentWaiting,
      isAgentReviewing,
    }) === "interruptAgent") {
      interruptActiveAgentRun();
      return;
    }

    exit();
    return;
  }

  if (key.return) {
    void submitInput();
    return;
  }

  if (key.tab) {
    void triggerTabAgent();
    return;
  }

  if (character) {
    const next = getNextEditableInput(
      { input, cursorIndex },
      { type: "insert", text: character },
    );
    setInput(next.input);
    setCursorIndex(next.cursorIndex);
  }
});
```

这段代码是 TUI 交互核心：回车执行命令，Tab 请求 Agent 帮助，Ctrl-C 优先中断正在运行的 Agent。

### 3. Tab 触发 beforeRun

文件：`src/tui/app.tsx`

```tsx
async function triggerTabAgent() {
  const commandLine = input.trim();
  if (!commandLine) {
    return;
  }

  const context = await buildBeforeRunContext(commandLine, currentCwd, session);
  if (!context) {
    return;
  }

  lastTabAgentInput.current = context.rawCommand;
  await triggerBeforeRun(context);
}

async function triggerBeforeRun(context: CommandContext) {
  const agentHistoryId = appendPendingAgentHistoryEntry("command", context.rawCommand, "waiting");
  const controller = beginAgentRun(agentHistoryId, "command");

  setIsAgentWaiting(true);
  setActiveAgentKind("command");
  setAgentStatusCommand(context.rawCommand);

  try {
    const message = await commandAgent.current?.beforeRun?.(context, {
      signal: controller.signal,
    });

    setAgentSuggestedCommand(message?.suggestedCommand);
    updateAgentHistoryEntry(agentHistoryId, {
      state: message ? "success" : "empty",
      ...(message ? { content: message.content } : {}),
    });
  } finally {
    finishAgentRun(controller);
    setIsAgentWaiting(false);
    setActiveAgentKind(undefined);
    setAgentStatusCommand(undefined);
  }
}
```

用户按 Tab 时，GITX 不会执行命令，而是把命令上下文交给 Linus 做执行前分析。

### 4. 命令执行后触发 Agent 复盘

文件：`src/tui/app.tsx`

```tsx
async function runTuiCommand(commandLine: string) {
  setHistory((current) => [
    ...omitCompletedAgentToolProgress(current),
    { type: "input", text: commandLine },
  ]);

  setIsRunning(true);

  const result = await runCommandLine(commandLine, {
    cwd: currentCwd,
    ...(commandAgent.current ? { agent: commandAgent.current } : {}),
    ...(larkAgent.current ? { larkAgent: larkAgent.current } : {}),
    onOutput: updateUserLiveOutput,
  });

  setHistory((current) => [
    ...current,
    { type: "output", result },
  ].slice(-20));

  if (hasAfterSuccessReview(result)) {
    void triggerAfterSuccessReview(result);
  }

  if (hasAfterFailReview(result)) {
    void triggerAfterFailReview(result);
  }

  setIsRunning(false);
}
```

命令执行成功后进入 `afterSuccess`，执行失败后进入 `afterFail`。因此 Agent 可以结合真实 stdout、stderr 和 exit code 给出建议。

### 5. Agent 建议命令补全

文件：`src/tui/input.ts`

```ts
export function getAgentSuggestedCompletion({
  input,
  suggestedCommand,
}: {
  input: string;
  suggestedCommand?: string | undefined;
}): CompletionCandidate | undefined {
  const normalizedInput = input.trim();
  const normalizedCommand = suggestedCommand?.trim();
  if (!normalizedCommand || !normalizedCommand.startsWith(normalizedInput)) {
    return undefined;
  }

  return {
    completion: normalizedCommand,
    suffix: normalizedCommand.slice(normalizedInput.length),
  };
}
```

Agent 返回的 `suggestedCommand` 会变成 ghost completion，用户可以按右方向键直接接受建议命令。
