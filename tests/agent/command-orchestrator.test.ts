import assert from "node:assert/strict";
import test from "node:test";

import { createCommandOrchestrator } from "../../src/agent/command-orchestrator.js";

test("command orchestrator delegates beforeRun to command agent once", async () => {
  const calls: string[] = [];
  const orchestrator = createCommandOrchestrator({
    commandAgent: {
      beforeRun(context) {
        calls.push(context.rawCommand);
        return {
          content: "status help",
          suggestedCommand: "git status --short",
          supplementalLookups: [
            {
              type: "lark.docs",
              query: "团队 git status 规范",
              reason: "before_run_git_status_policy",
            },
          ],
        };
      },
    },
  });

  assert.deepEqual(
    await orchestrator.beforeRun({
      cwd: "/repo",
      command: "git",
      args: ["status"],
      rawCommand: "git status",
    }),
    {
      content: "status help",
      suggestedCommand: "git status --short",
      supplementalLookups: [
        {
          type: "lark.docs",
          query: "团队 git status 规范",
          reason: "before_run_git_status_policy",
        },
      ],
    },
  );
  assert.deepEqual(calls, ["git status"]);
});

test("command orchestrator resolves lark docs supplemental lookups", async () => {
  const commandCalls: string[] = [];
  const larkSearches: unknown[] = [];
  const orchestrator = createCommandOrchestrator({
    commandAgent: {
      beforeRun(context) {
        commandCalls.push(context.rawCommand);
        return {
          content: "push help",
          suggestedCommand: "git status",
          supplementalLookups: [
            {
              type: "lark.docs",
              query: "团队 git push PR 规范",
              reason: "before_run_git_push_policy",
              displayHint: "append_as_team_policy",
            },
          ],
        };
      },
    },
    larkAgent: {
      searchDocs(context) {
        larkSearches.push(context);
        return Promise.resolve({
          content: "团队规范：push 后创建 PR，并邀请维护者 review。",
        });
      },
    },
  });

  assert.deepEqual(
    await orchestrator.beforeRun({
      cwd: "/repo",
      command: "git",
      args: ["push"],
      rawCommand: "git push origin main",
    }),
    {
      content:
        "push help\n\n团队资料：\n团队规范：push 后创建 PR，并邀请维护者 review。",
      suggestedCommand: "git status",
      supplementalLookups: [
        {
          type: "lark.docs",
          query: "团队 git push PR 规范",
          reason: "before_run_git_push_policy",
          displayHint: "append_as_team_policy",
        },
      ],
    },
  );
  assert.deepEqual(commandCalls, ["git push origin main"]);
  assert.deepEqual(larkSearches, [
    {
      cwd: "/repo",
      query: "团队 git push PR 规范",
      command: "git",
      rawCommand: "git push origin main",
      reason: "before_run_git_push_policy",
      displayHint: "append_as_team_policy",
    },
  ]);
});

test("command orchestrator leaves supplemental lookups unresolved without lark agent", async () => {
  const orchestrator = createCommandOrchestrator({
    commandAgent: {
      beforeRun() {
        return {
          content: "push help",
          supplementalLookups: [
            {
              type: "lark.docs",
              query: "团队 git push PR 规范",
              reason: "before_run_git_push_policy",
            },
          ],
        };
      },
    },
  });

  assert.deepEqual(
    await orchestrator.beforeRun({
      cwd: "/repo",
      command: "git",
      args: ["push"],
      rawCommand: "git push",
    }),
    {
      content: "push help",
      supplementalLookups: [
        {
          type: "lark.docs",
          query: "团队 git push PR 规范",
          reason: "before_run_git_push_policy",
        },
      ],
    },
  );
});

test("command orchestrator delegates afterSuccess to command agent once", async () => {
  const calls: string[] = [];
  const orchestrator = createCommandOrchestrator({
    commandAgent: {
      afterSuccess(context, result) {
        calls.push(`${context.rawCommand}:${result.exitCode}`);
        return {
          content: "push done",
          followUpActions: [
            {
              type: "collaboration.notification",
              reason: "after_success_git_push_review",
              title: "通知维护者 review",
              draftMessage: "我刚 push 了当前分支，请帮忙 review。",
              confirmationMode: "explicit_followup",
            },
          ],
        };
      },
    },
  });

  assert.deepEqual(
    await orchestrator.afterSuccess(
      {
        cwd: "/repo",
        command: "git",
        args: ["push"],
        rawCommand: "git push",
      },
      {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
    ),
    {
      content: "push done",
      followUpActions: [
        {
          type: "collaboration.notification",
          reason: "after_success_git_push_review",
          title: "通知维护者 review",
          draftMessage: "我刚 push 了当前分支，请帮忙 review。",
          confirmationMode: "explicit_followup",
        },
      ],
    },
  );
  assert.deepEqual(calls, ["git push:0"]);
});

test("command orchestrator delegates afterFail to command agent once", async () => {
  const calls: string[] = [];
  const orchestrator = createCommandOrchestrator({
    commandAgent: {
      afterFail(context, result) {
        calls.push(`${context.rawCommand}:${result.exitCode}`);
        return {
          content: "check command",
          suggestedCommand: "which aaa",
        };
      },
    },
  });

  assert.deepEqual(
    await orchestrator.afterFail(
      {
        cwd: "/repo",
        command: "aaa",
        args: [],
        rawCommand: "aaa",
      },
      {
        exitCode: 127,
        stdout: "",
        stderr: "command not found: aaa\n",
      },
    ),
    {
      content: "check command",
      suggestedCommand: "which aaa",
    },
  );
  assert.deepEqual(calls, ["aaa:127"]);
});
