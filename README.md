# git-helper

飞书 AI 校园挑战赛项目。目标是做一个面向开发者 Git 工作流的智能 CLI/TUI 工具：用户像使用 Git Bash 一样输入命令，`git-helper` 负责理解命令上下文、查询通用 Git 手册和飞书组织知识库，并在合适的阶段给出帮助、报错修复建议或协作通知。

## 项目目标

`git-helper` 希望解决三个核心场景：

1. **命令使用帮助**
   用户输入类似 `git status ?`、`git push ?` 时，Agent 不实际执行命令，而是根据命令内容查询通用 Git 手册和团队规范，返回简短、可执行的使用说明。

2. **Git 报错诊断**
   用户执行 Git 命令失败后，Agent 获取命令、退出码、stdout、stderr，并结合飞书知识库中的团队经验，返回原因解释和修复步骤。

3. **协作通知**
   例如用户完成 `git push` 并创建 PR 后，Agent 总结变更信息，并通过飞书通知对应维护者进行 review。

## 当前进度

当前阶段重点是先搭好产品主干，还没有把飞书 API 接入核心运行链路。

已完成：

- CLI 名称设为 `git-helper`。
- 无参数启动时进入 TUI，形成类似 Git Bash 的交互入口。
- runtime 层完成命令解析、命令分类和帮助请求识别。
- 支持的 Git 命令、自定义命令和其他命令已经有明确分类。
- 支持 Git 子命令 Tab 补全，例如输入 `git sta` 可补全到 `git status`。
- 命令末尾加 `?` 时进入 `askForHelp` 流程，不执行原命令。
- Agent 侧定义了 `askForHelp`、`beforeRun`、`afterSuccess`、`afterFail` 四个阶段接口。
- LangChain agent 已改为官方 `createAgent` 模式，工具调用由 LangChain 编排。
- 已接入第一个工具 `tldr_git_manual`，用于查询 tldr 中的 Git 命令快速手册。
- 已封装基础 `lark-cli` 能力，包括 status、setup、login、docs search 等入口。
- 已建立测试覆盖，当前包含 runtime、command、agent、integrations 等测试。

暂未完成：

- 飞书知识库 API 尚未接入 Agent 的真实检索流程。
- `beforeRun`、`afterSuccess`、`afterFail` 暂时只保留接口，没有接入主执行链路。
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
  commands/       CLI 子命令，例如 init、lark
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

- `askForHelp`：用户在命令末尾输入 `?`，请求命令帮助。
- `beforeRun`：命令执行前，可用于风险提示、规范检查。
- `afterSuccess`：命令执行成功后，可用于总结、通知、下一步建议。
- `afterFail`：命令执行失败后，可用于报错诊断和修复建议。

当前只实际接入了 `askForHelp`。

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
git status ?
git push ?
```

飞书 CLI 相关命令：

```bash
npm run dev -- lark status
npm run dev -- lark setup
npm run dev -- lark login
```

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
   完成命令输入、命令分类、执行流程、帮助请求、Tab 补全、Agent phase 接口。

2. **第二阶段：通用 Git 手册能力**
   接入 tldr / git help，让 Agent 能稳定回答 Git 命令基础用法。

3. **第三阶段：飞书知识库接入**
   登录飞书后选择组织 Git 规范文档，后续命令帮助和报错诊断优先结合团队知识。

4. **第四阶段：错误诊断闭环**
   在命令失败后自动进入 `afterFail`，结合 stderr、tldr、飞书知识库输出修复建议。

5. **第五阶段：协作通知**
   对 push、PR 等协作场景生成总结，并通过飞书通知维护者。
