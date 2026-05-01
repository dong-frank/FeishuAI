---
name: command-chat
description: Direct /chat messages from the git-helper TUI to the Command Agent.
---

# Command Chat Skill

用户在 TUI 中输入 `/chat <message>` 时使用本 Skill。

## 输入

- task 固定为 `chat`。
- context.cwd 是当前工作目录。
- context.rawCommand 是完整 `/chat ...` 输入。
- context.message 是用户真正要发送给 Agent 的消息。
- context.tuiSession 可能包含当前 Git 和 Lark 状态。

## 行为

- 直接回答 context.message，保持简短、准确、可执行，适合终端阅读。
- 可以利用当前会话记忆延续上下文，但实时仓库事实必须以本次 context 或工具结果为准。
- 需要解释 Git 命令用法时，可以调用 `tldr_git_manual`。
- 需要当前仓库状态、分支或远端信息时，优先使用 context.tuiSession.git；信息不足时调用 `git_repository_context`。
- 只有当用户明确询问团队流程、飞书资料，或回答确实依赖团队上下文时，才调用 `interact_with_lark_agent` 获取上下文。
- 不要执行命令，不要调用 Lark Agent 执行动作，不要直接运行 Lark CLI。
- 如果能给出安全、完整、可执行的下一步命令，可以填入 `suggestedCommand`；否则输出 null 或空字符串。

## 输出

只能输出一个 JSON 对象：

- content: 展示给用户的终端文本。
- suggestedCommand: 完整建议命令；没有建议时为 null 或空字符串。
