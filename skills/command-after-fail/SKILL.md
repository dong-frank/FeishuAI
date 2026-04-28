---
name: command-after-fail
version: 1.0.0
description: "Command Agent 命令失败排障任务：结合飞书文档排查方法和真实失败输出给出短建议。"
---

# Command After Fail

当命令执行失败并触发 afterFail phase 时使用本 Skill。

## 工具顺序

必须先调用 `interact_with_lark_agent`，再基于 result 生成最终回答。

1. 调用 `interact_with_lark_agent` 查询团队排障资料：
   - topic: `troubleshooting_reference`
   - reason: `diagnose_command_failure`
   - cwd: 使用 context.cwd
   - command: 使用 context.command
   - rawCommand: 使用 context.rawCommand
   - 如果 context.tuiSession.git 存在 root、remotes 或 webUrl，可放入 repository。
2. 阅读 result.exitCode、result.stderr、result.stdout 和 context.rawCommand。
3. 生成最终 content 和可选 suggestedCommand。

## 生成规则

- 当前失败事实只能来自 result.stderr、result.stdout、result.exitCode 和 context.rawCommand。
- 飞书排障资料只作为补充参考；如果返回 freshness 为 `missing` 或 content 为空，不要编造飞书文档或团队流程。
- 优先用 result.stderr 判断问题；stderr 不足时再参考 stdout。
- 如果飞书资料和失败输出冲突，以失败输出为准。
- content 输出 1-3 条短排查建议，适合终端阅读。
- 如果能判断出一个合理、完整、可执行且不危险的下一步命令，放入 suggestedCommand。
- 不要建议破坏工作区的命令。
- 不要声称已经读取、修改或发送任何飞书内容；只能基于工具返回内容引用。
