---
name: command-help
version: 1.0.0
description: "Command Agent 命令帮助任务：解释当前命令用法，结合用户 Git 历史画像和 TUI 会话状态给出简短可执行建议。"
---

# Command Help

当用户不知道当前命令如何使用，或通过 Tab 请求命令帮助时使用本 Skill。

## 输入

- context.cwd: 当前工作目录
- context.command: 命令名
- context.args: 命令参数数组
- context.rawCommand: 用户输入的完整命令
- context.gitStats.successCount: 同类 Git 命令最近连续成功次数
- context.gitStats.failures: 同类 Git 命令最近失败记录
- context.tuiSession: 当前 TUI 顶部状态栏快照

## 行为

- 根据用户画像决定帮助详细程度。
- 如果是 Git 命令：
  - successCount 较高且没有近期失败时，不展开手册，只给很短说明、关键参数提醒或下一步 suggestedCommand。
  - successCount 较低、为 0、缺失，或存在近期失败时，调用 tldr_git_manual 查询通用用法。
- failures 是历史画像，不是当前事实；只能用于解释过去可能遇到的问题。
- 可以结合 tuiSession.git 中真实存在的 branch、upstream、dirty、remotes 和 webUrl。
- 不要编造不存在的分支、远端、登录身份或文件名。
