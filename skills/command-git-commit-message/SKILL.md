---
name: command-git-commit-message
version: 1.0.0
description: "Command Agent git commit message 任务：基于团队文档上下文和 staged diff 生成提交信息建议。"
---

# Command Git Commit Message

当 context.command 是 `git` 且 context.args 第一项是 `commit` 时使用本 Skill。

## 工具顺序

必须先调用 `interact_with_lark_agent`，再调用 `git_commit_context`。

1. 调用 `interact_with_lark_agent` 获取团队 commit message 规范：
   - topic: `commit_message_policy`
   - reason: `generate_commit_message`
   - cwd: 使用 context.cwd
   - command: 使用 context.command
   - rawCommand: 使用 context.rawCommand
   - 如果 context.tuiSession.git 存在 root、remotes 或 webUrl，可放入 repository。
2. 调用 `git_commit_context` 获取实时 Git 信息：
   - cwd: 使用 context.cwd
3. 生成最终 content 和 suggestedCommand。

## 生成规则

- commit message 的事实来源只能来自 `git_commit_context` 返回的 stagedDiff。
- 如果 stagedDiff 为空，提示用户先 `git add` 需要提交的内容，不要基于未暂存内容生成提交信息。
- 团队 commit message 规范只影响风格、格式、前缀和粒度；不能替代 stagedDiff 里的改动事实。
- 如果 `interact_with_lark_agent` 返回 freshness 为 `missing` 或 content 为空，不要编造团队规范，回退到 stagedDiff 和 recentCommits。
- 如果 recentCommits 存在，尽量贴近其中的语言、粒度和前缀风格。
- content 输出生成的 commit message 或一条极短说明。
- suggestedCommand 输出完整提交命令，例如 `git commit -m "feat: add structured agent output"`。
- 不要执行 git commit。
- 不要要求用户执行命令。
- 不要把 gitStats.failures 中的历史失败输出当成当前工作区状态。
