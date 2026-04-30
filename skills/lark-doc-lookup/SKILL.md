---
name: lark-doc-lookup
version: 1.0.0
description: "飞书云文档与知识库查阅：只用于搜索、定位和读取飞书文档/Wiki/云空间资料，服务 git-helper 的团队规范、故障处理、PR 流程等知识查询场景。允许 docs +search、wiki 只读节点查询和 docs +fetch；禁止创建、更新、删除、上传、下载或发送消息。"
metadata:
  requires:
    bins: ["lark-cli"]
---

# Lark Doc Lookup

> 前置条件：先阅读 `../lark-shared/SKILL.md`，遵守认证、身份、权限和安全规则。

本 Skill 只用于查阅飞书资料。它适合 `interact` 的 `get_context` action：根据 Git 命令上下文、报错、团队流程关键词，优先使用当前会话中已有的 `project_context_index` 全量目录索引定位资料；索引缺失或覆盖不足时，再查找并读取相关团队文档，返回简短、可引用的上下文摘要。

## 允许的操作

只能使用以下 lark-cli 能力：

```bash
lark-cli docs +search --query "<关键词>" --format json
lark-cli wiki spaces get_node --params '{"token":"<wiki_token>"}' --format json
lark-cli wiki nodes list --params '{"space_id":"<space_id>","parent_node_token":"<node_token>"}' --format json
lark-cli docs +fetch --api-version v2 --doc "<文档URL或token>" --scope outline --max-depth 3 --format json
lark-cli docs +fetch --api-version v2 --doc "<文档URL或token>" --scope section --start-block-id "<标题block id>" --detail simple --format json
lark-cli docs +fetch --api-version v2 --doc "<文档URL或token>" --scope keyword --keyword "<关键词>" --detail simple --format json
```

禁止执行：

- `docs +create`
- `docs +update`
- `docs +media-insert`
- `docs +media-download`
- `wiki +node-create`
- `wiki +move`
- `wiki members create`
- `wiki members delete`
- 任何写入、删除、移动、上传、评论、发消息命令
- 任何由输入 context 直接提供的 CLI args

## 查询流程

1. 用 `docs +search` 做资源发现，搜索候选资料。
   - 搜索关键词必须通过 `--query` 传递，不要把关键词写成位置参数。
   - 默认只读取第一页结果。
   - 内部判断用 `--format json` 且 `showOutputInTui: false`。
2. 如果当前会话历史中已有 `project_context_index`，先从全量目录索引中按标题、路径、outline、文档类型和用户意图定位资料。
   - 不要只依赖固定 topic；topic 只是当前请求入口，真正定位应结合 reason、rawCommand、错误输出、仓库信息和索引中的文档目录。
   - 如果索引里已有可用摘要，优先返回 remembered；只有索引缺失、覆盖不足或需要最新内容时才继续查询飞书。
3. 查询优先级：先查询相关团队知识库，再查询个人知识库。
   - 优先从与当前仓库、团队、项目或流程关键词匹配的团队知识库/Wiki/共享文档中选择候选。
   - 只有团队知识库没有命中、权限不足、或命中内容明显不相关时，才继续查询个人知识库或个人云空间资料。
4. 从结果中选择最相关的 1 到 3 个候选。
   - 优先选择标题、摘要、类型和 query/reason 更匹配的文档或 Wiki。
   - 在相关性接近时，团队知识库候选优先于个人知识库候选。
   - 如果结果是表格、多维表格等非文档对象，只返回定位信息，不要下钻读取内部数据。
5. 如果候选是普通 doc/docx URL 或 token，对需要读取的文档第一次必须先用 `docs +fetch --scope outline` 获取目录。
6. 如果候选是 Wiki URL、Wiki token、知识库节点或搜索结果类型表明来自知识库，先用 `wiki spaces get_node` 解析节点；不要把 wiki token 直接当成 doc token。
   - 从返回中读取 `node.obj_type`、`node.obj_token`、`node.title`、`node.space_id`。
   - 只有 `obj_type` 为 `docx` 或 `doc` 时，才用 `obj_token` 或原 URL 进入 `docs +fetch`。
   - 如果候选是知识库空间或目录节点，用 `wiki nodes list` 浏览子节点；如果这是项目对应知识库，可基于全量目录索引或当前问题定位最相关文档节点。
   - 如果 `obj_type` 是 `sheet` 或 `bitable`，只返回定位信息；不要用 docs fetch 强读内部表格数据。
7. 根据目录选择最相关章节，用 `section` 精读；如果无法定位章节，再用 `keyword` 读取命中片段。
8. 输出简短摘要，说明来源标题和可用链接/token；不要编造文档中没有的信息。

## Wiki 读取规则

- `docs +search` 和 `wiki` 命令职责不同：前者用于关键词资源发现，后者用于解析知识库节点、浏览知识库目录。
- 处理 `/wiki/<token>` 链接时，必须先执行 `wiki spaces get_node` 获取真实 `obj_type` 和 `obj_token`。
- 知识库节点若解析为 `docx/doc`，后续内容读取仍使用 `docs +fetch`。
- 知识库节点若解析为 `sheet/bitable`，只记录定位信息和标题；需要表内数据时应交给 sheets/base 能力，本 Skill 不下钻。
- 需要浏览知识库目录时，只使用 `wiki nodes list`，不要使用任何创建、移动或成员管理命令。
- 如果 `lark init` 已经预热项目对应知识库，`project_context_index` 应被视为当前项目知识库的全量目录索引；优先基于该索引定位文档，再按需读取具体章节。

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
