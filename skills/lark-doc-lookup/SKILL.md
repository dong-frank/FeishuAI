---
name: lark-doc-lookup
version: 1.0.0
description: "飞书云文档查阅：只用于搜索、定位和读取飞书文档/Wiki/云空间资料，服务 git-helper 的团队规范、故障处理、PR 流程等知识查询场景。允许 docs +search 和 docs +fetch；禁止创建、更新、删除、上传、下载或发送消息。"
metadata:
  requires:
    bins: ["lark-cli"]
---

# Lark Doc Lookup

> 前置条件：先阅读 `../lark-shared/SKILL.md`，遵守认证、身份、权限和安全规则。

本 Skill 只用于查阅飞书资料。它适合 `searchDocs` 任务：根据 Git 命令上下文、报错、团队流程关键词，查找并读取相关团队文档，返回简短、可引用的终端摘要。

## 允许的操作

只能使用以下 lark-cli 能力：

```bash
lark-cli docs +search --query "<关键词>" --format json
lark-cli docs +fetch --api-version v2 --doc "<文档URL或token>" --scope outline --max-depth 3 --format json
lark-cli docs +fetch --api-version v2 --doc "<文档URL或token>" --scope section --start-block-id "<标题block id>" --detail simple --format json
lark-cli docs +fetch --api-version v2 --doc "<文档URL或token>" --scope keyword --keyword "<关键词>" --detail simple --format json
```

禁止执行：

- `docs +create`
- `docs +update`
- `docs +media-insert`
- `docs +media-download`
- 任何写入、删除、移动、上传、评论、发消息命令
- 任何由输入 context 直接提供的 CLI args

## 查询流程

1. 用 `docs +search` 搜索候选资料。
   - 搜索关键词必须通过 `--query` 传递，不要把关键词写成位置参数。
   - 默认只读取第一页结果。
   - 内部判断用 `--format json` 且 `showOutputInTui: false`。
2. 从结果中选择最相关的 1 到 3 个候选。
   - 优先选择标题、摘要、类型和 query/reason 更匹配的文档或 Wiki。
   - 如果结果是表格、多维表格等非文档对象，只返回定位信息，不要下钻读取内部数据。
3. 对需要读取的文档，第一次读取必须先用 `docs +fetch --scope outline` 获取目录。
4. 根据目录选择最相关章节，用 `section` 精读；如果无法定位章节，再用 `keyword` 读取命中片段。
5. 输出简短摘要，说明来源标题和可用链接/token；不要编造文档中没有的信息。

## 读取策略

- 优先局部读取，不要为了省事全量读取整篇文档。
- 第一次接触文档时先读 `outline`。
- 有明确标题或目录命中时用 `section`。
- 只有关键词线索时用 `keyword`。
- 默认 `detail simple`；只有需要 block id 定位时才用 `with-ids`。

## 权限和失败处理

- 搜索云空间对象通常需要 `search:docs:read`。
- 读取文档内容需要对应文档访问权限。
- 如果权限不足，只基于 lark-cli 返回内容说明缺少权限或授权，不要猜测文档内容。
- 如果没有搜索结果，说明未找到相关资料，并建议换关键词或补充文档范围。

## 输出要求

- 面向终端，简短、准确、可执行。
- 明确区分“搜索结果摘要”和“文档原文结论”。
- 每个结论必须能追溯到已读取的搜索结果或文档内容。
- 不要输出大段原文；只摘取必要短句或做摘要。
