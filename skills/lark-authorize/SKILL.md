---
name: lark-authorize
version: 1.0.0
description: "飞书/Lark CLI 授权引导：检查连接状态，按需配置应用凭证、登录授权并验证。当用户需要初始化飞书连接、修复未登录状态、配置 lark-cli、执行 lark init 或确认飞书连接可用时使用。"
metadata:
  requires:
    bins: ["lark-cli"]
---

# Lark Authorize

> **前置条件：** 先阅读 [`../lark-shared/SKILL.md`](../lark-shared/SKILL.md)。

本 Skill 用于引导用户完成 lark-cli 与飞书的连接。不要直接假设需要重新配置或重新登录；必须先检查当前状态，再根据返回结果决定下一步。

## 输出展示规则

- 内部判断用命令默认使用 `showOutputInTui: false`，由 Agent 读取返回内容后总结。
- 需要用户打开链接、扫码、输入验证码或等待授权完成的命令使用 `showOutputInTui: true`。
- 如果某一步需要把命令结果直接展示给用户，使用 `showOutputInTui: true` 时必须选择合适的输出格式：`--format pretty` 适合说明性结果，`--format table` 适合列表，`--format json` 仅在用户需要原始 JSON 时使用。

## 流程

### Step 1: 检查当前状态

先执行：

```bash
lark-cli auth status
```

调用 `run_lark_cli` 时设置 `showOutputInTui: false`。

根据输出判断：

- 如果状态显示已登录、身份可用或已有有效授权：说明连接已可用，直接进入 Step 4 再验证一次并总结当前状态。
- 如果状态显示未登录、缺少授权、token 失效或需要登录：进入 Step 3。
- 如果状态显示应用凭证未配置、找不到 appId/appSecret、缺少配置文件或要求先 `config init`：进入 Step 2。
- 如果命令不存在或 lark-cli 未安装：提示用户先安装 `@larksuite/cli` 和 lark skills，不要继续执行后续步骤。
- 如果输出不明确：简短说明无法判断当前状态，并建议先按 Step 2 重新配置或请用户提供完整错误输出。

### Step 2: 配置应用凭证

仅当 Step 1 表明应用凭证未配置或配置无效时执行。

在后台运行此命令。命令会输出一个授权链接；提取该链接并发送给用户。用户在浏览器中完成配置后，命令会自动退出。

```bash
lark-cli config init --new
```

调用 `run_lark_cli` 时设置 `showOutputInTui: true`。

执行要求：

- 将输出中的授权链接清楚发给用户。
- 等待命令结束后再继续。
- 如果命令失败，只基于 stdout/stderr 说明失败原因，不要编造配置结果。
- 配置完成后进入 Step 3。

### Step 3: 登录授权

当 Step 1 表明未登录、授权缺失或 Step 2 刚完成配置后执行。

在后台运行此命令。命令会输出一个授权链接；提取该链接并发送给用户。用户在浏览器中完成登录授权后，命令会自动退出。

```bash
lark-cli auth login --recommend
```

调用 `run_lark_cli` 时设置 `showOutputInTui: true`。

执行要求：

- 将输出中的授权链接清楚发给用户。
- 等待命令结束后再继续。
- 如果命令失败，只基于 stdout/stderr 说明失败原因。
- 登录完成后进入 Step 4。

### Step 4: 验证连接

最后执行：

```bash
lark-cli auth status
```

调用 `run_lark_cli` 时设置 `showOutputInTui: false`。

根据输出给出简短结论：

- 已连接：说明当前身份、授权状态和可用信息。
- 未连接：说明缺少配置还是缺少登录，并给出下一步建议。
- 权限不足：说明需要增量授权；优先按缺失 scope 执行 `lark-cli auth login --scope "<missing_scope>"`。

## 安全规则

- 禁止输出 appSecret、accessToken、refreshToken 等密钥。
- 不要声称已完成配置或登录，除非对应命令返回成功且 Step 4 验证通过。
- 不要对 bot 身份执行 `auth login`；bot 权限问题应引导用户到飞书开发者后台开通 scope。
- 写入或删除飞书资源不属于本 Skill 范围。

## 输出要求

- 回答简短、明确、适合终端阅读。
- 如果需要用户打开链接，只输出必要说明和链接。
- 每一步结论必须基于命令返回内容。
