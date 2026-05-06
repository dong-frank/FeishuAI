---
name: lark-shared
version: 1.0.0
description: "GITX 项目内飞书共享规则：当 Friday 需要处理 lark-cli 身份、/login 授权、scope 缺失、权限不足或安全边界时使用。"
---

# GITX Lark Shared

本 skill 是 GITX 内所有飞书 skill 的共享规则。用户入口统一是 `/login`；Friday 可以在 TUI 内部用受控 lark-cli 命令完成配置、授权和验证，但不要把底层命令当成用户需要手动执行的入口。

## 身份

- `--as user`：以当前授权用户身份操作，适合“以我的身份发送/写入/读取”。需要应用后台开通 scope，也需要用户授权。
- `--as bot`：以应用机器人身份操作，适合“让 Friday 通知”。只依赖应用后台和机器人可见范围，不能通过用户授权补齐 bot scope。

## 授权入口

- 用户看到和输入的入口只有 `/login`。
- 需要用户打开链接、扫码、输入验证码或等待授权完成时，调用 `run_lark_cli` 必须设置 `showOutputInTui: true`。
- 内部检查状态或读取 JSON 时，`showOutputInTui: false`。

## 权限不足处理

先从 lark-cli stdout/stderr 中提取身份、缺失 scope、`permission_violations`、`console_url` 和 hint。

### User 身份

- 未登录、token 失效或缺少 user scope 时，Friday 可以在当前 TUI 内部发起最小 scope 授权。
- 优先按错误中的缺失 scope 授权；如果发送消息只缺 scope 且错误没有给全，使用 `im:message.send_as_user`。
- 授权命令需要实时展示给用户，等待命令结束后再重试原操作一次。
- 对用户解释时只说“通过 /login 补齐权限”，不要让用户手动运行底层授权命令。

### Bot 身份

- bot scope 缺失不能通过用户授权修复。
- 返回后台权限问题；如果 lark-cli 输出包含 `console_url`，把它作为下一步。
- 不要对 bot 身份发起用户登录授权。

## 安全规则

- 禁止输出 appSecret、accessToken、refreshToken。
- 不要编造权限已补齐；必须以授权命令和重试命令的实际返回为准。
- 同一个失败操作最多自动补授权并重试一次，避免循环。
