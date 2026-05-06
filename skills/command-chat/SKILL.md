---
name: command-chat
description: Direct /chat messages from the GITX to the Linus.
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
- 只有当用户明确询问团队流程、飞书资料，或回答确实依赖团队上下文时，才调用 `interact_with_lark_agent` 的 `get_context` 获取上下文。
- 当用户在 context.message 中明确要求写入、更新、发送或通知时，才可以调用 `interact_with_lark_agent` 执行敏感飞书动作：
  - 写入或更新团队开发记录时使用 action: `write_development_record`。
  - 发送飞书消息或通知维护者时使用 action: `send_message`。
  - 预约会议、创建日程或安排 review meeting 时使用 action: `schedule_meeting`。
  - 写入或更新飞书多维表格/Base/bitable 记录时使用 action: `write_base_record`。
  - 发送消息时尽量传入 recipient、message 和 identity；用户说“让 Friday/机器人/你通知”时 identity 用 `bot`，用户说“以我的身份/我来发送”时 identity 用 `user`。
  - 预约会议时尽量传入 title、start、end、attendeeIds、description；时间、参会人 ID 或会议室选择不明确时先澄清，不要创建。
  - 写多维表格时尽量传入 baseToken、tableId、recordId 和 fields；目标表、字段或写入值不明确时先澄清，不要写入。
  - 如果目标文档、写入内容、收件人、消息内容、会议时间、参会人、Base 目标或字段值不明确，先在 content 中询问澄清，不要执行动作。
  - 不要把 afterSuccess 的建议当作授权；只有当前 `/chat` 消息里的明确要求才算授权。
- 不要执行命令：不要执行本地 shell 命令，不要直接运行 Lark CLI；飞书侧动作只能通过上面的受控 `interact_with_lark_agent` action。
- 如果能给出安全、完整、可执行的下一步命令，可以填入 `suggestedCommand`；否则输出 null 或空字符串。

## 输出

只能输出一个 JSON 对象：

- content: 展示给用户的终端文本。
- suggestedCommand: 完整建议命令；没有建议时为 null 或空字符串。
