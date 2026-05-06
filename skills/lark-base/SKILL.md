---
name: lark-base
version: 1.0.0
description: "GITX 专用飞书多维表格能力：当 Friday 需要按 Linus 的 /chat 明确请求向 Base/多维表格创建或更新记录时使用。"
metadata:
  requires:
    bins: ["lark-cli"]
  cliHelp: "lark-cli base --help"
---

# GITX Lark Base

本 skill 只服务 GITX demo 中的多维表格记录写入路径。Friday 不建表、不改字段、不删记录、不做仪表盘、公式、lookup、workflow 或数据分析。

权限、身份和登录处理以项目内 `lark-shared` 为准。遇到未登录、token 失效或缺少 Base scope 时，先加载 `lark-shared`，按 `/login` 口径处理。

## write_base_record 快速流程

Friday 收到 `write_base_record` action 时，只执行下面流程。

1. 校验输入
   - 必须来自用户当前 `/chat` 的明确写入意图，例如“写入多维表格、更新 Base、记录到 bitable”。
   - 必须有 `baseToken`、`tableId` 和非空 `fields`。
   - `recordId` 存在时更新已有记录；没有 `recordId` 时创建新记录。
   - 如果用户只给了自然语言目标 `target`，没有 token/table，先澄清或要求 Linus 通过项目知识索引定位，不要猜 token。

2. 写入前读取字段
   - 先执行：`lark-cli base +field-list --base-token <baseToken> --table-id <tableId> --limit 100 --format json`
   - 只允许写真实存在且可写的字段。
   - 不写 formula、lookup、系统字段、附件字段；这些字段应忽略并在结果里说明。

3. 写入命令
   - 创建记录：
     `lark-cli base +record-upsert --base-token <baseToken> --table-id <tableId> --json '<fields_json>'`
   - 更新记录：
     `lark-cli base +record-upsert --base-token <baseToken> --table-id <tableId> --record-id <recordId> --json '<fields_json>'`
   - `fields_json` 必须是 JSON object，不要拼接非 JSON 文本。
   - 内部判断用 `showOutputInTui: false`。

4. 权限
   - user 身份缺 scope、未登录或 token 失效时，按 `lark-shared` 发起最小授权，`showOutputInTui: true`，完成后重试原写入命令一次。
   - bot 身份缺后台 scope 时不要用户登录，返回后台权限问题。

## 输出要求

- 成功：返回简短 JSON，说明 Base/table、创建或更新、record_id。
- 未写入：返回简短 JSON，说明缺少 token/table/fields、字段不可写或权限失败。
- 不要编造写入成功；只以 lark-cli 实际返回为准。
- 不要暴露长篇命令帮助或通用 Base 说明。
