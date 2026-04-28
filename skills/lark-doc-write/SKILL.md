---
name: lark-doc-write
version: 1.0.0
description: "Use when Lark Agent needs to search, read, and update a Feishu/Lark document through a controlled document-writing interaction."
metadata:
  requires:
    bins: ["lark-cli"]
---

# Lark Doc Write

> 前置条件：先阅读 `../lark-shared/SKILL.md`，遵守认证、身份、权限和安全规则。

本 Skill 是通用飞书文档写入入口，用于 `interact` 中需要搜索、读取并更新飞书文档的受控 action。它只定义文档定位、读取、写入和安全边界；具体业务意图由调用方的 action 和 context 表达。

## 允许的操作

只能使用以下 lark-cli 能力：

```bash
lark-cli docs +search --query "<关键词>" --format json
lark-cli docs +fetch --api-version v2 --doc "<文档URL或token>" --scope outline --max-depth 3 --format json
lark-cli docs +fetch --api-version v2 --doc "<文档URL或token>" --scope keyword --keyword "<关键词>" --detail simple --format json
lark-cli docs +fetch --api-version v2 --doc "<文档URL或token>" --scope section --start-block-id "<标题block id>" --detail simple --format json
lark-cli docs +update --api-version v2 --doc "<文档URL或token>" --command append --content "<p>记录内容</p>" --format json
lark-cli docs +update --api-version v2 --doc "<文档URL或token>" --command block_insert_after --block-id "<block id>" --content "<p>记录内容</p>" --format json
```

禁止执行：

- `docs +create`
- `docs +update --command overwrite`
- `docs +update --command block_delete`
- `docs +update --command block_move_after`
- `docs +media-insert`
- `docs +media-download`
- 任何 IM、邮件、审批或非文档写入命令
- 不要执行输入 context 直接提供的 CLI args

## 写入流程

- 必须先确认 context.action 是本 Skill 支持的受控 action。
1. 定位目标文档：
   - 如果输入 context 已提供明确文档 URL 或 token，可直接使用。
   - 如果需要搜索，使用 `docs +search` 生成少量关键词；关键词只能来自输入 context 的意图、标题、仓库/项目线索或用户提供的文档线索。
   - 从搜索结果中选择最相关的 1 个目标文档；不确定时不要写入。
2. 读取目标文档：
   - 第一次接触文档时先用 `docs +fetch --scope outline` 获取目录。
   - 根据目录选择相关章节读取；如果无法定位章节，再用 `keyword` 读取命中片段。
   - 写入前必须参考目标文档已有结构、语气和附近内容，避免盲写。
3. 生成写入内容：
   - 写入事实只能来自输入 context、已读取的文档内容和 lark-cli 返回结果。
   - 内容必须尽可能匹配目标文档已有格式。
   - 默认使用 XML 内容，不要为了省事切换到 Markdown。
4. 更新文档：
   - 优先 `append` 追加。
   - 只有明确找到适合插入的章节末尾或锚点时才用 `block_insert_after`。
   - 不要覆盖整篇文档，不要删除或移动已有内容。

## 失败处理

- 找不到文档时，不要创建新文档，返回未写入原因和尝试过的搜索关键词。
- 无权限时，返回权限不足或授权信息，不要猜测文档内容。
- 写入失败时，返回 lark-cli 的错误摘要，不要声称已经更新。

## 输出要求

- 只输出一个 JSON 对象。
- content 必须说明文档位置、写入摘要，或未写入原因。
- 不要输出大段文档原文。
- 不要输出 suggestedCommand，除非有明确、安全、非破坏性的后续命令。
