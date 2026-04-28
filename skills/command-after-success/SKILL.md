---
name: command-after-success
version: 1.0.0
description: "Command Agent Git 命令成功后建议任务：结合成功命令、命令输出和仓库上下文给出短下一步建议。"
---

# Command After Success

当关键 Git 命令成功并触发 afterSuccess phase 时使用本 Skill。

## 建议层次

先阅读 context.command、context.args、context.rawCommand、result.exitCode、result.stdout 和 result.stderr，再决定是否需要工具。

1. 常规下一步：
   - commit 后，通常建议 push、继续拆分提交或查看状态。
   - push 后，通常建议检查远端状态、打开 PR，或按团队流程联系维护者；不要声称已经通知任何人。
   - pull、merge、rebase 后，通常建议查看 git status，并按项目习惯运行必要测试。
2. 仓库上下文：
   - 如果需要确认当前分支、upstream、dirty 状态或远端地址，调用 `git_repository_context`。
   - 如果 context.tuiSession.git 已经包含足够信息，可以直接使用，不必重复调用工具。
3. 不确定时：
   - 保守给出查看状态或运行测试的建议。
   - 不要编造不存在的远端、分支、PR 地址、登录身份、维护者或文件名。

## 生成规则

- 不要复述成功输出，不要解释已经成功的事实。
- content 输出 1-3 条短建议，适合终端阅读。
- suggestedCommand 只能是一条完整、可执行且不危险的下一步命令。
- 如果无法判断明确下一步，suggestedCommand 留空或省略。
- 不要建议破坏工作区的命令。
- 不要声称已经读取、修改或发送任何飞书内容。
