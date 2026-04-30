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

- 已连接：说明当前身份、授权状态和可用信息，然后进入 Step 5。
- 未连接：说明缺少配置还是缺少登录，并给出下一步建议。
- 权限不足：说明需要增量授权；优先按缺失 scope 执行 `lark-cli auth login --scope "<missing_scope>"`。

### Step 5: Project Knowledge Warmup

仅当 Step 4 验证连接可用后执行。目标是在当前 Agent 会话历史中形成 `project_context_index`，供后续 commit message、排障、review 协作、需求状态和开发记录场景复用。v1 只保存在当前对话历史中，不写本地缓存。

输入 context 可能包含 `projectHints`：

- `repositoryName`
- `cwdName`
- `gitRoot`
- `branch`
- `remoteUrl`
- `webUrl`

根据 `projectHints` 先定位项目对应知识库，不要求用户手动指定文档。优先使用 `repositoryName`，其次使用 `cwdName`。建议用少量关键词只做知识库定位：

- `<项目名>`
- `<项目名> 知识库`
- `<项目名> 项目`
- `<项目名> 文档`

只允许执行以下只读命令，内部判断统一使用 `showOutputInTui: false`：

```bash
lark-cli docs +search --query "<关键词>" --format json
lark-cli wiki spaces get_node --params '{"token":"<wiki_token>"}' --format json
lark-cli wiki nodes list --params '{"space_id":"<space_id>","parent_node_token":"<node_token>"}' --format json
lark-cli docs +fetch --api-version v2 --doc "<文档URL或token>" --scope outline --max-depth 3 --format json
lark-cli docs +fetch --api-version v2 --doc "<文档URL或token>" --scope section --start-block-id "<标题block id>" --detail simple --format json
lark-cli docs +fetch --api-version v2 --doc "<文档URL或token>" --scope keyword --keyword "<关键词>" --detail simple --format json
```

读取策略：

- `docs +search` 只用于定位项目对应知识库或项目文档入口；不要把它当成最终资料集合。
- 如果命中 Wiki URL、Wiki token、知识库空间或知识库节点，先用 `wiki spaces get_node` 解析节点；不要把 wiki token 直接当成 doc token。
- `wiki spaces get_node` 返回中读取 `node.obj_type`、`node.obj_token`、`node.title`、`node.space_id` 和节点 token。确定 `space_id` 后，用 `wiki nodes list` 从项目知识库根节点或命中的目录节点开始遍历。
- 遍历项目对应知识库中的所有可读子节点，递归或逐层继续 `wiki nodes list`，直到覆盖该项目知识库中能访问到的文档节点；不要只按固定主题筛选。
- 对每个可读节点记录标题、路径、node token、obj_type、obj_token、space_id。形成全量目录索引后，再决定哪些 docx/doc 文档需要轻量读取。
- 对 `obj_type` 为 `docx` 或 `doc` 的节点，第一次读取必须先用 `docs +fetch --scope outline` 获取目录；只在目录过薄或标题不足以判断内容时，用 `keyword` 或少量 `section` 补充摘要。
- 对 `obj_type` 是 `sheet` 或 `bitable` 的节点，只记录标题、路径、token 和用途推断，不要用 docs fetch 强读内部表格数据。
- 如果项目知识库文档很多，可以分批处理，但最终 `project_context_index` 应说明已遍历范围、已索引数量、跳过数量和原因。
- 不要只按固定主题预热；主题是开放的，索引应服务后续任意 Git/Lark Agent 查询。
- 如果搜索或读取权限不足，只基于 lark-cli 返回内容说明原因，不要猜测文档内容。
- 如果无搜索结果，保留一个 missing 状态的 `project_context_index`，说明没有命中项目资料。

禁止执行：

- `docs +create`
- `docs +update`
- `docs +media-insert`
- `docs +media-download`
- `wiki +node-create`
- `wiki +move`
- 任何写入、删除、移动、上传、评论或发消息命令

预热完成后，在最终回答中简短列出：

- 扫描过的关键词
- 定位到的项目知识库或入口节点
- 已遍历节点数、已读取 outline 的文档数、跳过项数量和原因
- 已缓存的全量目录索引摘要
- 未完成项或权限问题

同时在当前会话历史中保留一段明确的 `project_context_index` 摘要，结构包括：

- project：项目名或仓库名
- knowledgeBase：知识库名称、space_id、入口 node token 或 URL
- documents：所有可读文档节点的标题、路径、obj_type、obj_token 或 node token
- outlines：docx/doc 文档的轻量目录或章节摘要
- nonDocResources：sheet、bitable 等非文档节点的标题、路径和定位信息
- coverage：已遍历范围、已索引数量、跳过数量和权限问题
- retrievalHints：后续查询时可按标题、路径、目录关键词、文档类型或用户意图快速定位

## 安全规则

- 禁止输出 appSecret、accessToken、refreshToken 等密钥。
- 不要声称已完成配置或登录，除非对应命令返回成功且 Step 4 验证通过。
- 不要对 bot 身份执行 `auth login`；bot 权限问题应引导用户到飞书开发者后台开通 scope。
- 写入或删除飞书资源不属于本 Skill 范围；Step 5 也只能读取文档。

## 输出要求

- 回答简短、明确、适合终端阅读。
- 如果需要用户打开链接，只输出必要说明和链接。
- 每一步结论必须基于命令返回内容。
