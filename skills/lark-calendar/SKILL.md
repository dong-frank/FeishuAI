---
name: lark-calendar
version: 1.0.0
description: "GITX 专用飞书日历能力：当 Friday 需要按 Linus 的 /chat 明确请求创建会议或日程时使用。"
metadata:
  requires:
    bins: ["lark-cli"]
  cliHelp: "lark-cli calendar --help"
---

# GITX Lark Calendar

本 skill 只服务 GITX demo 中的会议/日程创建路径。Friday 不做完整日历管理，不删除或修改已有日程，不展开复杂会议室推荐流程。

权限、身份和登录处理以项目内 `lark-shared` 为准。遇到未登录、token 失效或缺少日历 scope 时，先加载 `lark-shared`，按 `/login` 口径处理。

## schedule_meeting 快速流程

Friday 收到 `schedule_meeting` action 时，只执行下面流程。

1. 校验输入
   - 必须来自用户当前 `/chat` 的明确预约意图，例如“约会、预定会议、创建日程、安排 review”。
   - 必须有明确 `start` 和 `end`，格式使用 ISO 8601，例如 `2026-05-07T15:00:00+08:00`。
   - 必须有明确标题 `title`；没有时可用“会议”或从上下文生成短标题。
   - `attendeeIds` 已有明确 ID 时直接使用：`ou_` 用户、`oc_` 群、`omm_` 会议室。不要凭姓名猜 open_id，但允许按下面的查询流程先自动查询再使用唯一命中结果。

2. 自动查询参会对象
   - 如果 `attendeeIds` 为空，但 `rawRequest`、`title` 或 `description` 里出现群名关键词（例如 “FlowDesk Sprint 群”“演示群”），先自动查询群聊，不要直接要求用户提供 chat_id。
   - 查群命令：`lark-cli im +chat-search --query "<群名关键词>" --page-size 5 --format json`
   - 如果 `rawRequest`、`title` 或 `description` 里出现人员姓名（例如 “许嘉宁”），先自动查询用户，不要直接要求用户提供 open_id。
   - 查人命令：`lark-cli contact +search-user --query "<姓名或邮箱>" --format json`
   - 只接受唯一明确匹配：群聊用 `oc_` chat_id，用户用 `ou_` open_id。多个结果、空结果、权限不足或返回结构不清楚时，再返回澄清或 `/login` 权限提示。
   - 如果同时能定位群聊和具体用户，优先使用更贴近用户请求的对象；用户说“约许嘉宁”时优先 `ou_` 用户，用户说“约 FlowDesk Sprint 群”时优先 `oc_` 群。

3. 需要澄清时不要创建
   - 时间缺失、时间语义模糊、开始结束不完整，先澄清。
   - 用户需要会议室但没有明确 `omm_`，先澄清或返回需要用户选择会议室；不要自动猜会议室。
   - 参会人只有姓名或群名且自动查询后没有唯一明确匹配时，说明查询结果问题并要求用户补充更精确的人名、邮箱、open_id 或 chat_id。

4. 创建命令
   - 基本命令：`lark-cli calendar +create --summary "<title>" --start "<start>" --end "<end>"`
   - 有参会人：追加 `--attendee-ids "<ou_xxx,oc_xxx,omm_xxx>"`
   - 有描述：追加 `--description "<description>"`
   - 内部判断用 `showOutputInTui: false`。

5. 权限
   - 创建日程通常需要 `calendar:calendar.event:create`，邀请参会人还可能需要 `calendar:calendar.event:update`。
   - 查群可能需要 IM 搜索相关 scope，查人可能需要通讯录搜索相关 scope；缺权限时按 `lark-shared` 处理，不要让用户手动去群设置里找 ID。
   - user 身份缺 scope、未登录或 token 失效时，按 `lark-shared` 发起最小授权，`showOutputInTui: true`，完成后重试原创建命令一次。
   - bot 身份缺后台 scope 时不要用户登录，返回后台权限问题。

## 输出要求

- 成功：返回简短 JSON，说明会议标题、时间、参与人和 event_id 或日程链接。
- 未创建：返回简短 JSON，说明缺少哪项信息或哪个权限失败。
- 不要编造创建成功；只以 lark-cli 实际返回为准。
- 不要暴露长篇命令帮助或通用日历说明。
