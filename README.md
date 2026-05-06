# GITX

GITX 是一个面向新手开发者 Git 工作流的智能 CLI/TUI 工具。开发者可以在终端里像使用 Git Bash 一样输入 Git 命令，GITX 会在命令前、失败后、成功后提供帮助、排障建议和协作提醒。

## 环境要求

- Node.js 20+
- npm
- Git
- 可选：`lark-cli`，用于飞书授权、文档检索和协作动作

## 安装依赖

```bash
npm install
```

## 配置 `.env`

在项目根目录创建 `.env` 文件：

```bash
API_KEY=你的模型 API Key
BASE_URL=https://你的模型服务地址/v1
MODEL=你的默认模型名
```

可选配置：

```bash
COMMAND_MODEL=命令侧 Agent 使用的模型名
LARK_MODEL=飞书侧 Agent 使用的模型名
MAX_CONTEXT_WINDOW=128000
```

说明：

- `API_KEY`：模型服务密钥。
- `BASE_URL`：OpenAI 兼容接口地址。
- `MODEL`：默认模型名；未配置 `COMMAND_MODEL` 或 `LARK_MODEL` 时会回退到它。
- `COMMAND_MODEL`：Linus 使用，主要负责 Git 命令理解、报错诊断和终端建议。
- `LARK_MODEL`：Friday 使用，主要负责飞书文档、消息、会议和多维表格动作。
- `MAX_CONTEXT_WINDOW`：可选，用于 TUI 展示上下文窗口使用情况。

## 启动

开发模式启动：

```bash
npm run dev
```

构建后启动：

```bash
npm run build
npm start
```

## 基本使用

进入 TUI 后可以直接输入 Git 命令：

```bash
git status
git push
git commit
```

常用交互：

- 输入完整 Git 命令后按 `Tab`：触发命令前帮助，不执行原命令。
- 命令失败后：触发失败诊断，返回原因和下一步建议。
- 命令成功后：触发只读协作建议。
- 输入 `/chat <内容>`：明确请求飞书协作动作，例如写开发记录、通知 reviewer、更新需求看板。

飞书授权入口：

```bash
npm run dev -- /login
```

## FlowDesk Demo

FlowDesk 是项目内置的可复现 Demo 场景，会生成独立演示仓库到 `~/flowdesk-demo`。

常用 reset：

```bash
npm run experiment:flowdesk -- reset --stage commit-message
npm run experiment:flowdesk -- reset --stage conflict
npm run experiment:flowdesk -- reset --stage upstream
npm run experiment:flowdesk -- reset --stage post-push
```

以 upstream 场景为例：

```bash
npm run experiment:flowdesk -- reset --stage upstream
cd ~/flowdesk-demo
npm run --prefix /path/to/feishuAI dev
```

进入 TUI 后执行：

```bash
git push
```

GITX 会进入失败诊断流程，并给出类似下面的建议命令：

```bash
git push -u origin feature/fd-124-priority-filter
```

## 测试

```bash
npm test
```

## 项目文档

- [项目亮点](docs/project-highlights.md)
- [AI 亮点](docs/ai-highlights.md)
- [核心代码说明](docs/core-code.md)
- [GitHub Pages 展示页](docs/index.html)
