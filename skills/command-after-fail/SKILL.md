---
name: command-after-fail
version: 1.0.0
description: "Command Agent 命令失败排障任务：按错误复杂度选择 tldr 或飞书排障资料，结合真实失败输出给出短建议。"
---

# Command After Fail

当命令执行失败并触发 afterFail phase 时使用本 Skill。

## 排障层次

先阅读 result.exitCode、result.stderr、result.stdout 和 context.rawCommand，判断错误层次，再选择工具。

1. 简单的语法或参数错误：
   - 典型信号包括 unknown option、invalid option、usage、unknown subcommand、missing required、ambiguous argument、not a git command。
   - 这类错误不需要和 Lark Agent 交互。
   - 调用 `tldr_git_manual` 查询对应 Git 命令的通用用法，再直接回答。
2. 复杂问题：
   - 典型信号包括权限、认证、远端拒绝、分支保护、CI、团队流程、仓库规范、钩子、提交规范、发布流程或需要结合项目约定的问题。
   - 如果需要当前仓库状态、分支或远端信息，先调用 `git_repository_context`。
   - 只有这类复杂问题才调用 `interact_with_lark_agent` 查询团队排障资料：
     - topic: `troubleshooting_reference`
     - reason: `diagnose_command_failure`
     - cwd: 使用 context.cwd
     - command: 使用 context.command
     - rawCommand: 使用 context.rawCommand
     - 如果 context.tuiSession.git 存在 root、remotes 或 webUrl，可放入 repository。
3. 如果错误层次不确定，先基于 result 给出保守排查建议；只有明确需要团队资料时才查飞书文档。

## 生成规则

- 当前失败事实只能来自 result.stderr、result.stdout、result.exitCode 和 context.rawCommand。
- 飞书排障资料只作为补充参考；如果返回 freshness 为 `missing` 或 content 为空，不要编造飞书文档或团队流程。
- tldr 只作为通用命令用法参考；不要把 tldr 当成当前仓库状态。
- git_repository_context 只作为当前仓库上下文参考；不要把它当成失败输出本身。
- 优先用 result.stderr 判断问题；stderr 不足时再参考 stdout。
- 如果飞书资料和失败输出冲突，以失败输出为准。
- content 输出 1-3 条短排查建议，适合终端阅读。
- 如果能判断出一个合理、完整、可执行且不危险的下一步命令，放入 suggestedCommand。
- 不要建议破坏工作区的命令。
- 不要声称已经读取、修改或发送任何飞书内容；只能基于工具返回内容引用。
