# git-helper

飞书 AI 校园挑战赛项目。目标是做一个面向开发者 Git 工作流的智能 CLI/TUI 工具：用户像使用 Git Bash 一样输入命令，`git-helper` 负责理解命令上下文、查询通用 Git 手册和飞书组织知识库，并在合适的阶段给出帮助、报错修复建议或协作通知。

## 项目目标

`git-helper` 希望解决三个核心场景：

1. **命令使用帮助**
   用户输入完整命令后按 `Tab` 时，Agent 不实际执行命令，而是根据命令内容查询通用 Git 手册和团队规范，返回简短、可执行的使用说明。

2. **Git 报错诊断**
   用户执行 Git 命令失败后，Agent 获取命令、退出码、stdout、stderr，并结合飞书知识库中的团队经验，返回原因解释和修复步骤。

3. **协作通知**
   例如用户完成 `git push` 并创建 PR 后，Agent 总结变更信息，并通过飞书通知对应维护者进行 review。

## 当前进度

当前阶段重点是先搭好产品主干，还没有把飞书 API 接入核心运行链路。

已完成：

- CLI 名称设为 `git-helper`。
- 无参数启动时进入 TUI，形成类似 Git Bash 的交互入口。
- runtime 层完成命令解析、命令分类和命令执行流程。
- 所有 `git` 子命令都会按 Git 命令分类，并交给真实 Git 执行与报错。
- 支持 Git 子命令和文件路径 ghost 补全，例如输入 `git sta` 后可按 Right 接受到 `git status`。
- 按 `Tab` 时进入 `beforeRun` 流程，不执行原命令。
- Agent 侧定义了 `beforeRun`、`afterSuccess`、`afterFail` 三个命令阶段接口。
- LangChain agent 已改为官方 `createAgent` 模式，工具调用由 LangChain 编排。
- 已接入第一个工具 `tldr_git_manual`，用于查询 tldr 中的 Git 命令快速手册。
- 已封装基础 `lark-cli` 能力，包括 status、setup、login、docs search 等入口。
- 已建立测试覆盖，当前包含 runtime、command、agent、integrations 等测试。

暂未完成：

- 飞书知识库 API 尚未接入 Agent 的真实检索流程。
- `beforeRun`、`afterSuccess`、`afterFail` 已接入 TUI 主执行链路。
- PR 总结和飞书通知维护者还处于产品规划阶段。
- TUI 目前是基础交互形态，后续还需要增强输出渲染、流式反馈和状态展示。

## 产品形态

项目采用“前端 TUI + runtime + Agent + 工具集”的结构：

```text
用户输入命令
    ↓
TUI 入口
    ↓
runtime 解析命令、分类、判断是否请求帮助
    ↓
Agent 根据 phase 决定行为
    ↓
调用工具：tldr、飞书知识库、通知工具等
    ↓
返回命令说明、报错修复建议或协作通知结果
```

## 目录结构

```text
src/
  agent/          LangChain Agent 封装、命令 Agent、phase 接口
  commands/       CLI 子命令，例如 lark
  integrations/   外部工具集成，例如 lark-cli、tldr
  runtime/        命令解析、分类、补全、运行时流程
  tui/            Ink/React TUI 交互界面
tests/            单元测试与集成测试
skills/           项目内 Codex skills
weekly-report/    周期记录文档
```

## 核心设计

### Phase

Agent 介入命令生命周期的位置用 phase 表达：

- `beforeRun`：用户按 `Tab` 主动请求命令帮助、风险提示或规范检查。
- `afterSuccess`：命令执行成功后，可用于总结、通知、下一步建议。
- `afterFail`：命令执行失败后，可用于报错诊断和修复建议。

当前 TUI 已接入 `beforeRun`、`afterSuccess`、`afterFail`。

### Tools

Agent 工具统一放在 `COMMAND_AGENT_TOOLS` 中。当前已有：

- `tldr_git_manual`：查询 tldr Git 快速手册。

后续计划加入：

- `search_lark_docs`：搜索飞书文档或知识库。
- `read_lark_doc`：读取指定飞书文档内容。
- `notify_reviewer`：向维护者发送 PR review 通知。

## 使用方式

安装依赖：

```bash
npm install
```

开发运行：

```bash
npm run dev
```

进入 TUI：

```bash
npm run dev
```

在 TUI 中请求命令帮助：

```bash
git status
# 按 Tab
git push origin main
# 按 Tab
```

飞书 CLI 相关命令：

```bash
npm run dev -- lark init
```

## FlowDesk 可复现实验

FlowDesk 是当前项目内置的一组可重复运行的演示与评估 fixture，用来模拟一个新人开发者在团队 Git 工作流中遇到 commit message、冲突、upstream、push 后协作通知等场景。生成的模拟项目和裸远端仓库都放在 `.experiments/` 下，不会和 `git-helper` 源码混在一起。

实验入口：

```bash
npm run experiment:flowdesk -- reset
npm run experiment:flowdesk -- reset --stage commit-message
npm run experiment:flowdesk -- reset --stage conflict
npm run experiment:flowdesk -- reset --stage upstream
npm run experiment:flowdesk -- reset --stage post-push
npm run experiment:flowdesk -- export
npm run experiment:flowdesk -- score
```

生成目录：

```text
.experiments/flowdesk-demo/              # 独立的 FlowDesk Python 模拟项目
.experiments/remotes/flowdesk-demo.git   # 本地 bare origin remote
.experiments/flowdesk-lark-docs/         # 本地 Markdown 飞书文档替身
.experiments/results/                    # 导出数据和实验记录
.experiments/results/runs/               # TUI/manual flow JSONL run 文件
```

每次 `reset` 都是幂等的：会重建 demo 项目、remote、文档 fixture 和当前 stage 所需的 Git 状态。`reset` 完成后终端会打印当前实验目录、当前分支、推荐执行命令、预期触发 phase 和 case id。

### Stage 说明

```text
fresh
  初始化 FlowDesk demo 仓库，创建 main、origin remote 和基础提交。
  推荐命令：git status
  适合检查项目初始状态和团队文档 fixture。

commit-message
  切到 feature/fd-124-priority-filter，并写入 Dev A 的 staged diff。
  推荐命令：git commit
  预期 phase：beforeRun
  用于展示 git-helper 根据 staged diff 和团队规范生成 commit message。

conflict
  模拟 Dev B 已经 push 到 origin/main，Dev A 执行 rebase/pull 时会和 service.py 冲突。
  推荐命令：git pull --rebase origin main
  预期 phase：afterFail
  用于展示冲突诊断和结合团队排障手册给修复建议。

upstream
  Dev A 本地 feature 分支已有提交，但没有设置 upstream。
  推荐命令：git push
  预期 phase：afterFail
  用于展示 upstream 报错解释和 suggestedCommand。

post-push
  Dev A 已成功 push feature 分支。
  推荐命令：git push -u origin feature/fd-124-priority-filter
  预期 phase：afterSuccess
  用于展示写开发记录、更新需求状态、约 Senior Dev review 会议等后续协作能力。
```

### 手动演示流程

以 upstream 场景为例：

```bash
npm run experiment:flowdesk -- reset --stage upstream
cd .experiments/flowdesk-demo
npm run --prefix ../.. dev
```

进入 TUI 后执行 reset 输出中的推荐命令：

```bash
git push
```

这个命令会因为当前 feature 分支没有 upstream 而失败，随后 `git-helper` 应进入 `afterFail`，解释错误并给出类似下面的建议命令：

```bash
git push -u origin feature/fd-124-priority-filter
```

commit message 场景可以这样跑：

```bash
cd /Users/dong/2026/feishuAI
npm run experiment:flowdesk -- reset --stage commit-message
cd .experiments/flowdesk-demo
npm run --prefix ../.. dev
```

进入 TUI 后输入：

```bash
git commit
# 按 Tab，请求 beforeRun 帮助，不直接执行 commit
```

conflict 场景可以这样跑：

```bash
cd /Users/dong/2026/feishuAI
npm run experiment:flowdesk -- reset --stage conflict
cd .experiments/flowdesk-demo
npm run --prefix ../.. dev
```

进入 TUI 后输入：

```bash
git pull --rebase origin main
```

### 实验过程记录

`reset --stage <stage>` 会在 demo 仓库根目录写入：

```text
.experiments/flowdesk-demo/.git-helper-experiment.json
```

TUI 启动后会从当前目录向上查找这个标记文件。只有找到标记文件时才启用实验记录；普通项目不会写实验日志。

一次 manual flow 会写入 JSONL：

```text
.experiments/results/runs/<run_id>.jsonl
```

目前记录四类事件：

```text
command_submitted   用户提交的命令
command_completed   exitCode、stdout、stderr、durationMs
agent_completed     phase、agentKind、content、suggestedCommand、metadata
agent_failed        phase、agentKind、error
```

可以用下面的命令查看最近记录：

```bash
ls -lt .experiments/results/runs
tail -n 20 .experiments/results/runs/<run_id>.jsonl
```

### 导出和评分占位

当前 `export` 先导出静态 cases，并附带最近 run 文件摘要，不做正确性判断：

```bash
cd /Users/dong/2026/feishuAI
npm run experiment:flowdesk -- export
```

输出文件：

```text
.experiments/results/flowdesk-cases.jsonl
.experiments/results/flowdesk-export-summary.json
```

`score` 目前是 placeholder，用来保留后续接 Ragas 或等价评估器的位置：

```bash
npm run experiment:flowdesk -- score
```

输出文件：

```text
.experiments/results/flowdesk-score-summary.json
```

后续接入评估时，建议把 JSONL run 文件作为主数据源，LangSmith trace 作为辅助观察：JSONL 负责稳定复现实验输入输出，LangSmith 负责查看 Agent 内部调用链、token、耗时和 trace 细节。

## 环境变量

LangChain 模型配置读取：

```bash
API_KEY=...
MODEL=...
```

当前默认 baseURL 在代码中配置为火山兼容 OpenAI 接口：

```text
https://ark.cn-beijing.volces.com/api/v3
```

## 验证

```bash
npm test
npm run build
```

## 迭代路线

1. **第一阶段：TUI + runtime 主干**
   完成命令输入、命令分类、执行流程、Tab 主动请求 Agent、Right 接受补全、Agent phase 接口。

2. **第二阶段：通用 Git 手册能力**
   接入 tldr / git help，让 Agent 能稳定回答 Git 命令基础用法。

3. **第三阶段：飞书知识库接入**
   登录飞书后选择组织 Git 规范文档，后续命令帮助和报错诊断优先结合团队知识。

4. **第四阶段：错误诊断闭环**
   在命令失败后自动进入 `afterFail`，结合 stderr、tldr、飞书知识库输出修复建议。

5. **第五阶段：协作通知**
   对 push、PR 等协作场景生成总结，并通过飞书通知维护者。
