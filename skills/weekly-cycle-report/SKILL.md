---
name: weekly-cycle-report
description: Use when writing weekly or cycle review documents that include core outcomes, quantitative metrics, process retrospectives, blockers, breakthroughs, reusable learnings, AI collaboration, tools, code work, workflows, and project progress.
---

# Weekly Cycle Report

## Purpose

Generate a concise Chinese cycle report from raw weekly facts. The output should feel like a real personal work record: specific, grounded, reflective, and easy to paste into a team update form.

Save the final report as a Markdown file under the project `weekly-report/` directory.

## When To Use

Use this skill when the user asks to write:

- 周记录、周期记录、周报、复盘、阶段总结
- AI 使用记录、AI 共创记录、项目进展记录
- 包含“核心产出 / 量化指标 / 过程复盘与沉淀”的模板化文档

Do not invent facts. If important facts are missing, ask for them briefly or mark the item as “可补充”.

## Required Output Structure

Preserve this structure unless the user provides a different template:

```markdown
第X周期（M.D-M.D）

一、核心产出（必填）
[本周期最满意的一项成果。写成 1-2 段，说明做了什么、为什么重要、产出形态是什么。]

二、量化指标（必填）
- [指标 1]
- [指标 2]
- [指标 3]

三、过程复盘与沉淀（必填）
1. 这周主要搞定了哪些具体环节？用了什么方法或工具辅助？
[分点或短段落说明具体环节、AI 分工、工具、代码、测试、文档、工作流。]

2. 过程中有没有遇到什么特别不顺、卡住很久的情况？后来是怎么破局的？
[说明卡点、原因、尝试过的方法、最终破局方式。]

3. 有没有什么你觉得这次写得特别顺，或者下次还能直接复用的东西？
[沉淀可复用资产：提示词、脚本、接口封装、模板、流程、排障方法。]
```

## File Output

Always write the completed report to a `.md` file in the project root's `weekly-report/` directory.

- Create `weekly-report/` if it does not exist.
- Use a readable filename such as `cycle-1-2026-04-23-2026-04-25.md`.
- If the user provides a cycle name, include it in the filename when practical.
- After saving, tell the user the file path.
- Do not save drafts with unresolved placeholders unless the user explicitly asks for a draft.

## Writing Rules

- Use first person implicitly when natural, but avoid excessive “我”.
- Prefer concrete nouns and verbs: “完成 TUI 命令输入框和 Tab 补全” beats “优化体验”.
- Mention AI collaboration explicitly when relevant: “让 AI 先拆方案 / 写测试 / 查文档 / 实现骨架，我负责判断产品边界和验收”.
- Keep claims modest and verifiable.
- Quantitative metrics may include approximate counts: commits, tests, tools, commands, modules, docs, interfaces, days, scenarios.
- If metrics are unknown, use reasonable placeholders such as “约 X 个” only when the user gave enough context; otherwise write “可补充：提交次数 / 调用次数 / 使用场景数”.
- The final document should be polished but not corporate or inflated.

## Fact Gathering Checklist

When facts are available from conversation or repository state, use them. Otherwise ask for the smallest missing set:

- 周期名称和日期
- 最满意的核心成果
- 可量化指标
- 本周做过的具体环节
- 使用过的 AI / 工具 / 脚本 / 框架
- 最大卡点和破局方法
- 下次可复用的沉淀

## Style Example

```markdown
本周期最满意的成果是把 git-helper 从普通 CLI 雏形推进到了具备 TUI 交互和 Agent 工具接入基础的版本。它已经不只是执行命令，而是开始形成“用户输入 Git 命令 -> Agent 理解上下文 -> 查询通用手册或团队知识 -> 返回可执行建议”的产品闭环。
```
