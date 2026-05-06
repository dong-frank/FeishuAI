---
name: lark-im
version: 1.0.0
description: "GITX 专用飞书消息能力：当 Friday 需要按 Linus 的 /chat 明确请求发送飞书消息，或为发送消息定位群聊 chat_id 时使用。"
metadata:
  requires:
    bins: ["lark-cli"]
  cliHelp: "lark-cli im --help"
---

# GITX Lark IM

本 skill 只服务 GITX demo 中的消息发送路径。Friday 不做通用飞书 IM 管理，不创建群、不改群、不搜索历史消息、不下载附件、不处理 reaction 或 thread。

权限、身份和登录处理以项目内 `lark-shared` 为准。执行发送前先加载 `lark-shared`，发送或查群遇到权限不足时也按 `lark-shared` 的规则补授权。

## 角色边界

- Linus：面向用户的 GITX 助手，只有用户在 `/chat` 中明确要求“发送、通知、告知、发消息”时才会触发 `send_message`。
- Friday：执行飞书侧操作。Friday 必须按输入 context 做最小动作，不能扩写、改写或猜测收件人。
- 敏感副作用只来自 `/chat` 的明确自然语言请求；after-success 只能建议，不发送。

## send_message 快速流程

Friday 收到 `send_message` action 时，只执行下面流程。

1. 校验输入
   - 必须有 `message`，且内容来自用户明确意图或 Linus 整理后的明确通知文本。
   - 必须有 `recipient`。
   - 必须有发送身份 `identity`，只能是 `bot` 或 `user`。缺失且无法从“让 Friday 通知”“以我的身份发送”等措辞明确推断时，不发送，要求澄清。

2. 解析收件人
   - `recipient` 以 `oc_` 开头：按群聊 `chat_id` 发送。
   - `recipient` 以 `ou_` 开头：按用户 `user_id` 发送。
   - `recipient` 是群名关键词：先查群，只有唯一明确匹配时发送。
   - `recipient` 是人名、昵称或不明确文本：不要猜 open_id，不发送，要求用户提供 `ou_`、`oc_` 或明确群名。

3. 查群命令
   - 使用：`lark-cli im +chat-search --query "<群名关键词>" --page-size 5 --format json`
   - 只接受唯一明确匹配。多个相似结果、空结果、权限不足都要返回澄清或登录提示。

4. 发送命令
   - 群聊：`lark-cli im +messages-send --as <identity> --chat-id <oc_xxx> --text "<message>"`
   - 单聊：`lark-cli im +messages-send --as <identity> --user-id <ou_xxx> --text "<message>"`
   - demo 默认只发送纯文本 `--text`，保留换行和原文。
   - 不使用 markdown、post、图片、文件、音视频、卡片、回复、转发或撤回。

5. 权限与登录
   - user 身份缺 scope、未登录或 token 失效时，按 `lark-shared` 发起最小授权，`showOutputInTui: true`，等待用户完成后重试原发送命令一次。
   - user 发送消息通常需要 `im:message.send_as_user`；如果错误里还列出其他缺失 scope，以 lark-cli 返回为准。
   - bot 身份缺 scope 时不要登录；返回后台权限问题和 lark-cli 提供的 console_url 或错误摘要。
   - 对用户展示统一说“Friday 正在通过 /login 授权补齐权限”或“请在 GITX TUI 中运行 /login”，不提示任何旧授权入口或外部浏览器流程。

## 输出要求

- 成功：返回简短 JSON，说明发送目标、身份、message_id 或 chat_id。
- 未发送：返回简短 JSON，说明缺少哪项信息或哪个权限失败，并给出下一步。
- 不要编造发送成功；只以 lark-cli 实际返回为准。
- 不要暴露长篇命令帮助、API schema 或通用 IM 说明。
