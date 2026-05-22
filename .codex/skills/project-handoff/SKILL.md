---
name: project-handoff
description: Generate concise project handoff notes and a copy-ready continuation prompt for another coding agent. Use when the user wants to transfer ongoing repo work to a new conversation, preserve version or phase progress, avoid context overflow, summarize completed implementation work, or create a next-agent prompt grounded in the current repository state.
---

# Project Handoff

Create a practical handoff for continuing repository work in another conversation or by another agent.

## Core Rule

Do not paste the full conversation. Produce only the actionable state needed to continue the work.

Ground the handoff in the current repository state. Prefer reading actual files and git state over relying only on chat history.

## Workflow

1. Identify the repository root, current branch, and git status.
2. Read project instructions and active planning files when present:
   - `AGENTS.md`
   - `CLAUDE.md`
   - `README.md`
   - `roadmap.md`
   - `plan.md`
   - `todo.md`
   - files under `docs/design/`, especially implementation plans
   - files under `docs/state/`, only to understand unresolved issues
   - prototype or handoff files named `HANDOFF.md`
3. Inspect changed files with `git status --short` and, when useful, `git diff --stat` or targeted `git diff`.
4. Summarize completed work, incomplete work, changed files, validation commands, known issues, and exact next task.
5. Generate a copy-ready continuation prompt for the next agent.

Keep exploration focused. Do not read human-only memo folders unless the project instructions or user explicitly request it.

## Output Format

Use Chinese by default unless the user asks for another language.

Use this structure:

```md
# Handoff

## 当前仓库

- 路径：
- 当前分支：
- 当前阶段：
- 当前 phase：

## 必读文件

- `AGENTS.md`
- `roadmap.md`
- ...

## 已完成

- ...

## 未完成

- ...

## 本轮修改文件

- `path/to/file`：做了什么

## 验证结果

- `command`：结果
- 未运行的命令：原因

## 风险与阻塞

- ...

## 下一个 Agent 应继续做什么

- 明确下一步 phase 或任务
- 明确不要扩大范围

## 禁止事项

- 不要做超出当前计划的功能
- 不要重写无关文件
- 不要恢复已废弃流程
- 不要绕过项目规则

## 可直接复制给下一个 Agent 的 Prompt

```text
你现在在 [repo path] 仓库工作。

先阅读：
1. ...
2. ...

当前任务：
...

执行规则：
...

完成后汇报：
1. ...
2. ...
```
```

## Quality Bar

A good handoff must be:

- short enough to paste into a new conversation
- specific enough that the next agent does not need old chat history
- file-centric and phase-centric
- explicit about scope boundaries
- honest about validation and unresolved issues
- clear about which files were actually changed versus only proposed

## Scope Guidance

If the project uses versions, milestones, phases, or tickets, preserve that structure exactly. Do not merge phases or advance the next agent beyond the intended next step.

If implementation is partially complete, separate:

- completed and verified
- completed but unverified
- started but incomplete
- planned but not started

If validation failed, include the command and failure summary. Do not hide it.

If the worktree contains unrelated user changes, mention them only if they affect the next task. Do not ask the next agent to revert unrelated changes unless the user explicitly requested it.

## What Not To Do

- Do not include complete chat logs.
- Do not invent completed work.
- Do not describe planned work as already done.
- Do not hide failed validation.
- Do not ask the next agent to decide scope when scope is already in the plan.
- Do not record mainline progress into issue/state files unless the project rules require it.
