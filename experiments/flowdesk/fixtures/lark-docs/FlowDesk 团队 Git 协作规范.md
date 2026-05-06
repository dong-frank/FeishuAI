# FlowDesk 团队 Git 协作规范

## 分支命名

功能分支使用：

```text
feature/<story-id>-<short-desc>
```

示例：

```text
feature/fd-124-priority-filter
```

## Commit Message

使用 Conventional Commits：

```text
feat(scope): summary
fix(scope): summary
chore(scope): summary
```

FD-124 推荐 scope 是 `tickets`。不要使用 `update code`、`fix bug` 这类模糊提交信息。

## Push 后流程

push 成功后，GITX 的 afterSuccess 阶段只做只读建议，不直接写入飞书文档、不发送消息、不通知他人。需要用户在 TUI 中通过 `/chat` 手动触发后续协作动作。

建议顺序：

1. 根据 GITX 建议确认本次 push 摘要。
2. 手动执行 `/chat 把刚才 git push 写入团队开发记录`。
3. 手动执行 `/chat 把 FD-124 在 Sprint 12 需求看板多维表格里的状态更新为待 Review`。
4. 如需同步 Reviewer，手动执行 `/chat 通知许嘉宁 FD-124 已 push，准备进入代码 review`。
5. 如果变更涉及协作模块，再通过 `/chat` 明确要求安排 review 会议，例如 `/chat 明天下午 3 点约许嘉宁开 30 分钟 FD-124 代码 review 会议`。

## Review 约定

- 涉及 `flowdesk/tickets/service.py` 的改动必须邀请模块伙伴 review。
- FD-123 和 FD-124 都会改动工单列表行为，两个开发者需要同步排序与过滤逻辑。
- Review 会议说明应包含 Story、分支、变更摘要和重点风险。
- Senior Dev 许嘉宁负责关注项目 CI/CD；如果 push 后 CI 失败，优先同步给许嘉宁一起确认。
