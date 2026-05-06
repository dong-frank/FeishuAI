---
name: command-after-success
version: 1.1.0
description: "Linus Git 命令成功后建议任务：结合成功命令、命令输出、仓库上下文和只读飞书上下文给出短下一步建议。"
---

# Command After Success

当关键 Git 命令成功并触发 afterSuccess phase 时使用本 Skill。这个阶段是只读 advisor：可以读取 Git 状态，也可以读取飞书上下文，但不能写入文档、发送消息或通知他人。

## 建议层次

先阅读 context.command、context.args、context.rawCommand、result.exitCode、result.stdout 和 result.stderr，再决定是否需要工具。

1. git push 成功：
   - push 后只做只读检查和建议，不自动写飞书。
   - 如果需要确认当前分支、upstream、dirty 状态或远端地址，优先使用 context.tuiSession.git；信息不足时调用 `git_repository_context`。
   - 如果需要判断是否建议用户更新团队开发记录，调用 `interact_with_lark_agent` 读取上下文：
     - action: `get_context`
     - topic: `development_record_guidance`
     - reason: `after_success_git_push_guidance`
     - cwd: 使用 context.cwd
     - command: 使用 context.command
     - rawCommand: 使用 context.rawCommand
     - 如果 context.tuiSession.git 或 git_repository_context 返回 root、remoteUrl、webUrl，可放入 repository。
   - content 只说明建议，例如“可以把本次 push 摘要写入 GITX Friday 开发记录”。
   - 如果建议用户手动触发飞书写入，suggestedCommand 使用自然语言 `/chat`，例如 `/chat 把刚才 git push 写入团队开发记录`。
2. 其它成功命令：
   - commit 后，通常建议 push、继续拆分提交或查看状态，不写飞书。
   - pull、merge、rebase 后，通常建议查看 git status，并按项目习惯运行必要测试，不写飞书。
3. 不确定时：
   - 保守给出查看状态或运行测试的建议。
   - 不要编造不存在的远端、分支、PR 地址、登录身份、维护者、飞书文档或文件名。

## 生成规则

- 不要复述成功输出，不要解释已经成功的事实。
- content 输出 1-3 条短建议，适合终端阅读。
- suggestedCommand 只能是一条完整、可执行且不危险的下一步命令。
- 如果建议敏感飞书交互，suggestedCommand 必须是 `/chat ...`，不能是 lark-cli 命令。
- 如果无法判断明确下一步，suggestedCommand 留空或省略。
- 不要建议破坏工作区的命令。
- 不要声称自己读取之外的飞书动作已经发生；afterSuccess 不会修改任何飞书资源。
