import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  AFTER_FAIL_AGENT_SYSTEM_PROMPT,
  AFTER_SUCCESS_AGENT_SYSTEM_PROMPT,
  buildGitCommitContext,
  buildGitRepositoryContext,
  COMMAND_AGENT_OUTPUT_SCHEMA,
  COMMAND_AGENT_RESPONSE_FORMAT,
  COMMAND_AGENT_TOOL_RESPONSE_FORMAT,
  COMMAND_AGENT_TOOLS,
  COMMAND_AGENT_TASK_SKILLS,
  createCommandAfterFailTools,
  createCommandAfterSuccessTools,
  formatAfterSuccessAgentSystemPrompt,
  formatCommandAgentInvocation,
  createInteractWithLarkAgentTool,
  GIT_COMMIT_CONTEXT_DIFF_LIMIT,
  GIT_COMMIT_CONTEXT_SUMMARY_LIMIT,
  HELP_AGENT_SYSTEM_PROMPT,
  routeCommandAgentTask,
  parseCommandAgentOutput,
} from "../../src/agent/command-agent.js";

test("COMMAND_AGENT_TOOLS includes help and git commit context tools", () => {
  assert.deepEqual(COMMAND_AGENT_TOOLS.map((tool) => tool.name), [
    "load_skill",
    "tldr_git_manual",
    "git_commit_context",
    "interact_with_lark_agent",
  ]);
});

test("after-fail tools include tldr, git context, and lark interaction only", () => {
  assert.deepEqual(createCommandAfterFailTools().map((tool) => tool.name), [
    "tldr_git_manual",
    "git_repository_context",
    "interact_with_lark_agent",
  ]);
});

test("after-success tools include git repository context only", () => {
  assert.deepEqual(createCommandAfterSuccessTools().map((tool) => tool.name), [
    "git_repository_context",
  ]);
});

test("command agent structured output uses function calling", () => {
  assert.equal(COMMAND_AGENT_RESPONSE_FORMAT, COMMAND_AGENT_TOOL_RESPONSE_FORMAT);
  assert.equal(Array.isArray(COMMAND_AGENT_RESPONSE_FORMAT), true);
  assert.equal(COMMAND_AGENT_RESPONSE_FORMAT.length, 1);
  assert.equal(COMMAND_AGENT_RESPONSE_FORMAT[0]?.tool.type, "function");
});

test("command agent routes beforeRun tasks to command skills", () => {
  assert.deepEqual(COMMAND_AGENT_TASK_SKILLS, {
    help: "command-help",
    commitMessage: "command-git-commit-message",
    afterFail: "command-after-fail",
    afterSuccess: "command-after-success",
  });

  assert.equal(
    routeCommandAgentTask({
      cwd: "/repo",
      command: "git",
      args: ["commit"],
      rawCommand: "git commit",
    }),
    "commitMessage",
  );
  assert.equal(
    routeCommandAgentTask({
      cwd: "/repo",
      command: "git",
      args: ["status"],
      rawCommand: "git status",
    }),
    "help",
  );
});

test("formatCommandAgentInvocation builds task envelopes with fixed skills", () => {
  assert.equal(
    formatCommandAgentInvocation("commitMessage", {
      cwd: "/repo",
      command: "git",
      args: ["commit"],
      rawCommand: "git commit",
    }),
    JSON.stringify({
      task: "commitMessage",
      skill: "command-git-commit-message",
      context: {
        cwd: "/repo",
        command: "git",
        args: ["commit"],
        rawCommand: "git commit",
      },
    }),
  );

  assert.equal(
    formatCommandAgentInvocation(
      "afterSuccess",
      {
        cwd: "/repo",
        command: "git",
        args: ["push"],
        rawCommand: "git push",
      },
      {
        exitCode: 0,
        stdout: "Everything up-to-date",
        stderr: "",
      },
    ),
    JSON.stringify({
      task: "afterSuccess",
      skill: "command-after-success",
      context: {
        cwd: "/repo",
        command: "git",
        args: ["push"],
        rawCommand: "git push",
      },
      result: {
        exitCode: 0,
        stdout: "Everything up-to-date",
        stderr: "",
      },
    }),
  );
});

test("HELP_AGENT_SYSTEM_PROMPT only describes command help behavior", () => {
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /命令帮助 Agent/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /context\.gitStats\.successCount/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /context\.gitStats\.failures/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /context\.tuiSession/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /branches/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /remotes/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /header\.gitSummary/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /header\.larkSummary/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /大胆给出 suggestedCommand/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /用户不一定会接受/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /task: "help" \| "commitMessage"/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /skill: 系统根据 task 固定填入的 Skill 名称/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /load_skill/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /处理任务前必须先调用 load_skill/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /如果输入中的 skill 与上述固定映射不一致/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /interact_with_lark_agent/);
  assert.match(HELP_AGENT_SYSTEM_PROMPT, /历史画像/);
  assert.doesNotMatch(HELP_AGENT_SYSTEM_PROMPT, /## Task 用户希望你帮助生成commit message/);
  assert.doesNotMatch(HELP_AGENT_SYSTEM_PROMPT, /必须调用 tldr_git_manual/);
  assert.doesNotMatch(HELP_AGENT_SYSTEM_PROMPT, /afterSuccess/);
  assert.doesNotMatch(HELP_AGENT_SYSTEM_PROMPT, /generateCommitMessage/);
});

test("command task skills contain task-specific instructions", () => {
  const helpSkill = readSkill("command-help");
  const commitSkill = readSkill("command-git-commit-message");
  const afterFailSkill = readSkill("command-after-fail");
  const afterSuccessSkill = readSkill("command-after-success");

  assert.match(helpSkill, /tldr_git_manual/);
  assert.match(helpSkill, /successCount 较高/);
  assert.match(helpSkill, /failures 是历史画像/);

  assert.match(commitSkill, /先调用 `interact_with_lark_agent`，再调用 `git_commit_context`/);
  assert.match(commitSkill, /commit_message_policy/);
  assert.match(commitSkill, /stagedDiff/);
  assert.match(commitSkill, /不要把 gitStats\.failures/);

  assert.match(afterFailSkill, /interact_with_lark_agent/);
  assert.match(afterFailSkill, /troubleshooting_reference/);
  assert.match(afterFailSkill, /tldr_git_manual/);
  assert.match(afterFailSkill, /git_repository_context/);
  assert.match(afterFailSkill, /语法或参数错误/);
  assert.match(afterFailSkill, /复杂/);
  assert.match(afterFailSkill, /只有/);
  assert.match(afterFailSkill, /result\.stderr/);
  assert.match(afterFailSkill, /不要编造飞书文档/);

  assert.match(afterSuccessSkill, /git_repository_context/);
  assert.match(afterSuccessSkill, /push 后/);
  assert.match(afterSuccessSkill, /commit 后/);
  assert.match(afterSuccessSkill, /pull、merge、rebase 后/);
  assert.match(afterSuccessSkill, /不要复述成功输出/);
  assert.match(afterSuccessSkill, /suggestedCommand/);
  assert.match(afterSuccessSkill, /不要建议破坏工作区/);
});

test("AFTER_SUCCESS_AGENT_SYSTEM_PROMPT describes injected after-success skill behavior", () => {
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /成功后建议 Agent/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /task: "afterSuccess"/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /command-after-success/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /Skill 已由 runtime 注入/);
  assert.doesNotMatch(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /load_skill/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /git_repository_context/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /result\.exitCode/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /result\.stdout/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /下一步建议/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /大胆给出 suggestedCommand/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /用户不一定会接受/);
  assert.match(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /完整、可执行的下一步命令/);
  assert.doesNotMatch(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /## Task 用户刚成功执行了关键 Git 命令/);
  assert.doesNotMatch(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /tldr_git_manual/);
  assert.doesNotMatch(AFTER_SUCCESS_AGENT_SYSTEM_PROMPT, /generateCommitMessage/);
});

test("formatAfterSuccessAgentSystemPrompt injects the after-success skill", () => {
  assert.equal(
    formatAfterSuccessAgentSystemPrompt("Use git context."),
    `${AFTER_SUCCESS_AGENT_SYSTEM_PROMPT}

## Injected Skill: command-after-success

Use git context.`,
  );
});

test("AFTER_FAIL_AGENT_SYSTEM_PROMPT only describes failure behavior", () => {
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /失败后辅助 Agent/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /task: "afterFail"/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /command-after-fail/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /Skill 已由 runtime 注入/);
  assert.doesNotMatch(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /load_skill/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /interact_with_lark_agent/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /tldr_git_manual/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /git_repository_context/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /简单的语法或参数错误/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /复杂问题/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /result\.exitCode/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /result\.stderr/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /排查方向或下一步命令/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /大胆给出 suggestedCommand/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /用户不一定会接受/);
  assert.match(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /修复或排查命令/);
  assert.doesNotMatch(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /afterSuccess/);
  assert.doesNotMatch(AFTER_FAIL_AGENT_SYSTEM_PROMPT, /generateCommitMessage/);
});

test("all phase prompts keep terminal-friendly plain text output", () => {
  for (const prompt of [
    HELP_AGENT_SYSTEM_PROMPT,
    AFTER_SUCCESS_AGENT_SYSTEM_PROMPT,
    AFTER_FAIL_AGENT_SYSTEM_PROMPT,
  ]) {
    assert.match(prompt, /输出要适合终端阅读/);
    assert.match(prompt, /不要使用 Markdown 标题、表格、代码围栏、链接语法/);
    assert.match(prompt, /content/);
    assert.match(prompt, /suggestedCommand/);
  }
});

test("all phase prompts describe structured output boundaries", () => {
  for (const prompt of [
    HELP_AGENT_SYSTEM_PROMPT,
    AFTER_SUCCESS_AGENT_SYSTEM_PROMPT,
    AFTER_FAIL_AGENT_SYSTEM_PROMPT,
  ]) {
    assert.match(prompt, /不直接调用 Lark Agent/);
    assert.match(prompt, /不直接执行 Lark CLI/);
    assert.doesNotMatch(prompt, /followUpActions/);
    assert.doesNotMatch(prompt, /后续显式动作/);
  }
});

test("command agent schema accepts legacy structured output", () => {
  assert.equal(
    COMMAND_AGENT_OUTPUT_SCHEMA.safeParse({
      content: "执行 git status 查看状态",
      suggestedCommand: "git status --short",
    }).success,
    true,
  );
});

test("command agent schema rejects supplemental lookups", () => {
  assert.equal(
    COMMAND_AGENT_OUTPUT_SCHEMA.safeParse({
      content: "推送前先确认远端。",
      supplementalLookups: [
        {
          type: "lark.docs",
          query: "团队 git push PR review 规范",
          reason: "before_run_git_push_policy",
        },
      ],
    }).success,
    false,
  );
});

test("command agent schema rejects follow-up actions", () => {
  assert.equal(
    COMMAND_AGENT_OUTPUT_SCHEMA.safeParse({
      content: "push 成功后可以通知维护者。",
      followUpActions: [
        {
          type: "collaboration.notification",
          reason: "after_success_git_push_review",
          title: "通知维护者 review",
          draftMessage: "我刚 push 了当前分支，请帮忙 review。",
          confirmationMode: "explicit_followup",
        },
      ],
    }).success,
    false,
  );
});

test("command agent schema rejects unknown structured output fields", () => {
  assert.equal(
    COMMAND_AGENT_OUTPUT_SCHEMA.safeParse({
      content: "msg",
      suggestedCommand: "",
      extra: "ignored?",
    }).success,
    false,
  );
});

test("parseCommandAgentOutput parses structured JSON output", () => {
  assert.deepEqual(
    parseCommandAgentOutput(
      '{"content":"执行 git status 查看状态","suggestedCommand":"git status --short"}',
    ),
    {
      content: "执行 git status 查看状态",
      suggestedCommand: "git status --short",
    },
  );
});

test("parseCommandAgentOutput rejects follow-up actions and supplemental lookups", () => {
  const followUpActions = JSON.stringify({
    content: "push 后可以通知维护者。",
    suggestedCommand: "",
    followUpActions: [
      {
        type: "collaboration.notification",
        reason: "after_success_git_push_review",
        title: "通知维护者 review",
        draftMessage: "我刚 push 了当前分支，请帮忙 review。",
        confirmationMode: "explicit_followup",
      },
    ],
  });
  assert.deepEqual(parseCommandAgentOutput(followUpActions), { content: followUpActions });

  const invalid = JSON.stringify({
    content: "push 前后可以结合团队规范和通知维护者。",
    supplementalLookups: [
      {
        type: "lark.docs",
        query: "团队 git push PR review 规范",
        reason: "before_run_git_push_policy",
      },
    ],
  });
  assert.deepEqual(parseCommandAgentOutput(invalid), { content: invalid });
});

test("interact_with_lark_agent returns structured lark context through the lark agent", async () => {
  const calls: unknown[] = [];
  const interactWithLarkAgentTool = createInteractWithLarkAgentTool({
    larkAgent: {
      getContext(context: unknown) {
        calls.push(context);
        return Promise.resolve({
          topic: "commit_message_policy",
          content: "团队使用 conventional commits。",
          freshness: "refreshed",
        });
      },
    },
  });

  const result = await interactWithLarkAgentTool.invoke({
    topic: "commit_message_policy",
    cwd: "/repo",
    reason: "generate_commit_message",
    command: "git",
    rawCommand: "git commit",
    repository: {
      root: "/repo",
      webUrl: "https://github.com/dong/feishuAI",
    },
  });

  assert.deepEqual(JSON.parse(result), {
    topic: "commit_message_policy",
    content: "团队使用 conventional commits。",
    freshness: "refreshed",
  });
  assert.deepEqual(calls, [
    {
      topic: "commit_message_policy",
      cwd: "/repo",
      reason: "generate_commit_message",
      command: "git",
      rawCommand: "git commit",
      repository: {
        root: "/repo",
        webUrl: "https://github.com/dong/feishuAI",
      },
    },
  ]);
});

test("interact_with_lark_agent accepts troubleshooting reference requests", async () => {
  const calls: unknown[] = [];
  const interactWithLarkAgentTool = createInteractWithLarkAgentTool({
    larkAgent: {
      getContext(context: unknown) {
        calls.push(context);
        return Promise.resolve({
          topic: "troubleshooting_reference",
          content: "团队排障文档建议先检查认证状态。",
          freshness: "refreshed",
        });
      },
    },
  });

  const result = await interactWithLarkAgentTool.invoke({
    topic: "troubleshooting_reference",
    cwd: "/repo",
    reason: "diagnose_command_failure",
    command: "git",
    rawCommand: "git push",
  });

  assert.deepEqual(JSON.parse(result), {
    topic: "troubleshooting_reference",
    content: "团队排障文档建议先检查认证状态。",
    freshness: "refreshed",
  });
  assert.deepEqual(calls, [
    {
      topic: "troubleshooting_reference",
      cwd: "/repo",
      reason: "diagnose_command_failure",
      command: "git",
      rawCommand: "git push",
    },
  ]);
});

test("parseCommandAgentOutput falls back to plain text content", () => {
  assert.deepEqual(parseCommandAgentOutput("执行 git status 查看状态"), {
    content: "执行 git status 查看状态",
  });
});

test("parseCommandAgentOutput trims output and ignores blank suggested command", () => {
  assert.deepEqual(
    parseCommandAgentOutput('  {"content":"  msg  ","suggestedCommand":"   "}  '),
    {
      content: "msg",
    },
  );
});

test("parseCommandAgentOutput validates structured JSON shape before accepting it", () => {
  assert.deepEqual(
    parseCommandAgentOutput(
      '{"content":"msg","suggestedCommand":"git status","extra":"ignored?"}',
    ),
    {
      content:
        '{"content":"msg","suggestedCommand":"git status","extra":"ignored?"}',
    },
  );
  assert.deepEqual(parseCommandAgentOutput('{"content":123,"suggestedCommand":"git status"}'), {
    content: '{"content":123,"suggestedCommand":"git status"}',
  });
});

test("buildGitCommitContext runs fixed git commands", async () => {
  const calls: string[][] = [];
  const context = await buildGitCommitContext({
    cwd: "/repo",
    runGitCommand(args) {
      calls.push(args);
      const command = args.join(" ");
      if (command === "status --short") {
        return Promise.resolve({ exitCode: 0, stdout: "M  src/app.tsx\n", stderr: "" });
      }
      if (command === "diff --cached") {
        return Promise.resolve({ exitCode: 0, stdout: "cached diff", stderr: "" });
      }
      if (command === "log -5 --pretty=%s") {
        return Promise.resolve({ exitCode: 0, stdout: "feat: add tui\nfix: status\n", stderr: "" });
      }

      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    },
  });

  assert.deepEqual(calls, [
    ["status", "--short"],
    ["diff", "--cached"],
    ["log", "-5", "--pretty=%s"],
  ]);
  assert.deepEqual(context, {
    status: {
      command: "git status --short",
      exitCode: 0,
      stdout: "M  src/app.tsx",
      stderr: "",
      truncated: false,
    },
    stagedDiff: {
      command: "git diff --cached",
      exitCode: 0,
      stdout: "cached diff",
      stderr: "",
      truncated: false,
    },
    recentCommits: {
      command: "git log -5 --pretty=%s",
      exitCode: 0,
      stdout: "feat: add tui\nfix: status",
      stderr: "",
      truncated: false,
      subjects: ["feat: add tui", "fix: status"],
    },
  });
});

test("buildGitCommitContext truncates large git outputs", async () => {
  const longDiff = "d".repeat(GIT_COMMIT_CONTEXT_DIFF_LIMIT + 10);
  const longStatus = "s".repeat(GIT_COMMIT_CONTEXT_SUMMARY_LIMIT + 10);
  assert.equal(GIT_COMMIT_CONTEXT_DIFF_LIMIT, 3000);
  assert.equal(GIT_COMMIT_CONTEXT_SUMMARY_LIMIT, 1000);
  const context = await buildGitCommitContext({
    cwd: "/repo",
    runGitCommand(args) {
      const command = args.join(" ");
      if (command === "status --short") {
        return Promise.resolve({ exitCode: 0, stdout: longStatus, stderr: "" });
      }
      if (command === "log -5 --pretty=%s") {
        return Promise.resolve({ exitCode: 0, stdout: longStatus, stderr: "" });
      }
      return Promise.resolve({ exitCode: 0, stdout: longDiff, stderr: "" });
    },
  });

  assert.equal(context.status.stdout.length, GIT_COMMIT_CONTEXT_SUMMARY_LIMIT);
  assert.equal(context.status.truncated, true);
  assert.equal(context.stagedDiff.stdout.length, GIT_COMMIT_CONTEXT_DIFF_LIMIT);
  assert.equal(context.stagedDiff.truncated, true);
  assert.equal(context.recentCommits.stdout.length, GIT_COMMIT_CONTEXT_SUMMARY_LIMIT);
  assert.equal(context.recentCommits.truncated, true);
});

test("buildGitRepositoryContext runs fixed git context commands", async () => {
  const calls: string[][] = [];
  const context = await buildGitRepositoryContext({
    cwd: "/repo",
    runGitCommand(args) {
      calls.push(args);
      const command = args.join(" ");
      if (command === "status --short --branch") {
        return Promise.resolve({ exitCode: 0, stdout: "## main...origin/main\n M src/app.ts\n", stderr: "" });
      }
      if (command === "branch --show-current") {
        return Promise.resolve({ exitCode: 0, stdout: "main\n", stderr: "" });
      }
      if (command === "remote -v") {
        return Promise.resolve({ exitCode: 0, stdout: "origin\thttps://github.com/acme/repo.git (fetch)\norigin\thttps://github.com/acme/repo.git (push)\n", stderr: "" });
      }

      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "unexpected" });
    },
  });

  assert.deepEqual(calls, [
    ["status", "--short", "--branch"],
    ["branch", "--show-current"],
    ["remote", "-v"],
  ]);
  assert.deepEqual(context, {
    status: {
      command: "git status --short --branch",
      exitCode: 0,
      stdout: "## main...origin/main\n M src/app.ts",
      stderr: "",
      truncated: false,
    },
    branch: {
      command: "git branch --show-current",
      exitCode: 0,
      stdout: "main",
      stderr: "",
      truncated: false,
    },
    remotes: {
      command: "git remote -v",
      exitCode: 0,
      stdout: "origin\thttps://github.com/acme/repo.git (fetch)\norigin\thttps://github.com/acme/repo.git (push)",
      stderr: "",
      truncated: false,
    },
  });
});

function readSkill(name: string) {
  return readFileSync(join(process.cwd(), "skills", name, "SKILL.md"), "utf8");
}
