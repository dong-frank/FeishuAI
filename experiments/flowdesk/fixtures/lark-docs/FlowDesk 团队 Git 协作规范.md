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

push 成功后需要：

1. 写入 Sprint 开发记录。
2. 更新需求状态为 `待 Review`。
3. 邀请 Reviewer 进行代码 review。
4. 如果变更涉及协作模块，约 30 分钟 review 会议。

## Review 约定

- 涉及 `flowdesk/tickets/service.py` 的改动必须邀请模块伙伴 review。
- FD-123 和 FD-124 都会改动工单列表行为，两个开发者需要同步排序与过滤逻辑。
- Review 会议说明应包含 Story、分支、变更摘要和重点风险。
- Senior Dev 许嘉宁负责关注项目 CI/CD；如果 push 后 CI 失败，优先同步给许嘉宁一起确认。
