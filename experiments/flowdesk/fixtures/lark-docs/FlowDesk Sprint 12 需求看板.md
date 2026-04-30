# FlowDesk Sprint 12 需求看板

## 团队角色

| 角色 | 姓名 | 关注点 |
| --- | --- | --- |
| Scrum Master | 周启明 | 召集早上站会、暴露 blocker、推动 review 会议安排 |
| Product Owner | 林若澄 | 查看需求完成情况、维护验收标准、确认 Story 是否进入待 Review |
| Senior Dev | 许嘉宁 | tickets 模块协作 review、整体项目 CI/CD |
| New Dev | 饶东申 | 新加入团队的开发者，今天领取 FD-124；群聊中使用用户身份发送 |

## 早上站会背景

早上站会只作为任务分派和协作关系引入，不作为工具使用场景。

- Scrum Master 周启明主持站会，确认 Sprint 12 当天目标。
- Product Owner 林若澄希望今天推进 FD-124，并在下午查看需求完成情况。
- Senior Dev 许嘉宁提醒：自己正在处理 FD-123 的列表排序和项目 CI/CD，FD-124 push 后需要约一次代码 review。
- New Dev 饶东申领取 FD-124，站会结束后回到终端开始开发。

## Sprint 看板

| Story ID | 标题 | 状态 | 优先级 | 负责人 | 协作开发者 | Reviewer | 分支名 | Review 会议 | 验收标准 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FD-118 | 工单状态变更写入审计事件 | 已完成 | P2 | 许嘉宁 | 饶东申 | 周启明 | feature/fd-118-ticket-audit | 已完成 | 状态变更能记录 actor 和 action |
| FD-121 | 支持负责人按 assignee 查看工单 | 已完成 | P2 | 许嘉宁 | - | 周启明 | feature/fd-121-assignee-filter | 已完成 | 支持负责人可按 assignee 缩小列表 |
| FD-123 | 调整工单列表默认排序 | 开发中 | P1 | 许嘉宁 | 饶东申 | 周启明 | feature/fd-123-priority-sort | 2026-04-29 16:00 | 高优先级工单应排在列表前面 |
| FD-124 | 工单列表支持按优先级筛选 | 开发中 | P1 | 饶东申 | 许嘉宁 | 许嘉宁 | feature/fd-124-priority-filter | 待约定 | 用户可按 High / Medium / Low 筛选工单 |

协作说明：FD-124 完成 push 后，需要邀请许嘉宁做代码 review。必要时约 30 分钟 review 会议。
