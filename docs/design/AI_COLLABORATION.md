# AI 协作工作流

本项目（AgentHub / Conflux）由单人 + AI 协作开发，课题要求在有限时间内完成多版本迭代（V1 单聊 → V1.5 交互桥接 → V2 群聊 + Orchestrator → V3 自建 Agent）。前后端共用 TypeScript 全栈（Next.js + SQLite）。AI 写代码与执行阶段计划，代码交接给下一个 AI Agent 继续工作，文档与交接是工作流的一等公民。

## 1. 协作体系组成

### 1.1 Agent 分工

| Agent | 主要职责 | 典型场景 |
| --- | --- | --- |
| **Claude Code** | 写代码、精确修改、回应 review、生成 handoff | 阶段内的具体实现、code review、上下文快满时交接 |
| **Codex** | 写代码、跑阶段计划、调用 Skill | 长改、阶段计划落地、按 Skill 写入状态池 |
| **Cursor** | 文档写作 | 设计草稿、原型 handoff 起草、PR description 草拟 |

三者互写互审：Claude 写完一阶段由 Codex 跑 review 或 smoke；Codex 写完一段由 Claude 做精确 review；Cursor 起草的设计文档由 Claude / Codex 校对后纳入仓库。

### 1.2 文档清单

按用途分组列出本项目里"为协作而存在"的文档及其在仓库中的位置。

**共享规则（所有 Agent 必读）**

- `AGENTS.md`（根目录）— 三方 Agent 的公约：文件所有权、scope 边界、评审门、禁止项
- `CLAUDE.md`（根目录）— Claude Code 的入口，唯一内容是指向 `AGENTS.md`，避免 Codex / Cursor / Claude 三方规则分叉

**主线规划**

- `roadmap.md`（根目录）— V1 → V3 路线图 + 当前 phase 状态
- `docs/design/要求.md` / `prd初版.md`— 课题原始要求与产品需求初版
- `docs/design/ExecutePlan/V*.md`— 每个版本的实施计划，可直接交给 Agent 执行
- `docs/design/specs/vX-phase-X.Y.md`— ExecutePlan 拆出的可执行 phase 设计稿

**设计与契约**

- `docs/design/TECH_DESIGN.md`— 适配器、Provider、Orchestrator、自建 Agent 等技术设计
- `docs/design/API_CONTRACT.md`— HTTP / SSE / WebSocket 契约
- `docs/design/REVIEW_CHECKLIST.md`— 各阶段验收与评审门

**UI 原型**

- `docs/design/prototypes/v{1,2,3}/*.html` + `HANDOFF.md`— 静态原型与前端 handoff
- 原型定的是信息架构与交互规则，不直接复用 HTML 到生产代码

**状态池**

- `docs/state/README.md`— 写入格式约定
- `docs/state/TODO.md`— 主线外小优化（带 P1/P2/P3 评级）
- `docs/state/TOFIX.md`— bug、回归、技术债（带 P1/P2/P3 评级）
- `docs/memo/`— 人类思考笔记，AI 默认不读取

**交接**

- `HANDOFF.md`（根目录）— 由 `project-handoff` Skill 生成的接力文档

### 1.3 Codex Skills

| Skill | 作用 | 触发场景 |
| --- | --- | --- |
| `project-handoff` | 生成 `HANDOFF.md`（含接力 prompt） | 上下文快满 / 切 Agent / 阶段收口 |
| `state-tofix` | 按格式写入 `TOFIX.md` | review / QA 后暂不修的问题 |
| `state-todo` | 按格式写入 `TODO.md` | 主线外的小优化 |
| `memo-capture` | 把讨论沉淀成 `docs/memo/*.md` | 选型 / 取舍 / 协作复盘 |

每个 Skill 都明确"使用边界"——哪些不归它管，思路与 `AGENTS.md` 的文件所有权一致，避免 AI 把不同性质的工作混在一起写。

## 2. 阶段迭代工作流

每做一版（V1 / V1.5 / V2 / V3 ...）都按以下循环推进：

1. **读需求，整理待办** — 阅读 `docs/design/要求.md`、`prd初版.md`，把这一版要解决的问题拆成若干需求点
2. **写 Roadmap** — 在 `roadmap.md` 里确定本版的目标、范围与不做项；明确本版之后的下一版方向
3. **写 ExecutePlan** — 在 `docs/design/ExecutePlan/V*.md` 里把本版的需求拆成若干 phase，每个 phase 写出目标、scope、文件所有权、验收标准
4. **细化为 Phase Spec** — 让 Agent 把 ExecutePlan 中的每个 phase 细化成 `docs/design/specs/vX-phase-X.Y.md`，落到可执行的设计（具体到接口、数据结构、关键路径）
5. **按 Phase 执行** — Agent 读 `ExecutePlan` + 对应 `phase spec`，按文件所有权写代码 → 另一 Agent 做 review → 跑 `REVIEW_CHECKLIST.md` 勾选 → 阶段收口

阶段之间若上下文快满或主动切 Agent，调 `project-handoff` 生成 `HANDOFF.md`：包含当前 phase、已完成 / 未完成事项、修改文件、验证命令、风险与阻塞、以及"可直接复制给下个 Agent 的接力 prompt"。

### 2.1 走样：V3.7（当前）

- `roadmap.md` 标出 V3.7 = SDK Approval / Choice 桥接
- `docs/design/ExecutePlan/V3-自建Agent与基础收口.md` 的 §七 V3.7 段写了阶段目标
- Codex 把这段细化为 `docs/design/specs/v3-phase-3.7.md`（C0 设计稿）
- C0 阶段在对话里拍板 4 个边界（Choice 用 MCP `request_choice`、拒绝后交还 SDK 自行继续、`executor` 不弹 Approval、第一版不抽共享 helper），这些结论直接写进 `HANDOFF.md` 的"已确认结论"段
- 下个 Agent 拿到 `HANDOFF.md` 附带的接力 prompt，直接从 C1（自建 SDK adapter 的 Approval 桥接）开始

## 3. 反思与教训

**有效的做法**

- **文档先行** — roadmap → ExecutePlan → phase spec → handoff 这一链，让每个阶段都有可被下一个 Agent 阅读的明确起点；救了很多次上下文溢出
- **文件所有权 = 互不踩脚** — `AGENTS.md` 把代码按"UI Shell / DB&API / 适配器 / Orchestrator / 评审"切块，多个 Agent 并行时不互相破坏
- **Skill 模板化高频动作** — 把"按格式写状态池""生成 handoff"这种每阶段都要做的事固化成 Skill，AI 自己就能完成，不需要人盯格式
- **评审只找问题、不动结构** — review agent 只看 bug / 边界 / 退化 / 缺测，写到 `TOFIX.md`；避免 AI 借 review 之名改坏东西
- **禁止项写进 handoff** — 例如 `不要改 lib/adapters/claude-code.ts`，挡住 AI 的"顺手优化"，是阶段间边界的硬约束

**踩过的坑**

- **不要抽过早抽象** — V3.7 明确"第一版不抽共享 helper"，避免影响稳定的内置 `@claude-code` 路径。AI 倾向把"看起来相似"的代码抽到一起，文档里需要主动拒绝
- **scope creep** — AI 容易被相邻文件"诱惑"（例：做 V3.7 时顺手改 Provider / 设置页 / Planner prompt），必须用文件所有权和禁止项约束
- **handoff 不只是溢出时才用** — 阶段收口时就应该交接——下个 Agent 不该靠记忆去推断哪些边界是用户已拍板的
- **写状态池要带边界** — `TOFIX.md` / `TODO.md` 都明文"不写主线任务"；没有这条，AI 会把所有问题都丢进去污染主线

**给单人 + AI 协作的建议**

- 把"约束"和"禁止项"当成第一公民写进文档
- 每个 Skill 设"使用边界"，和 `AGENTS.md` 文件所有权一个思路
- handoff 里的"接力 prompt"比 handoff 主体更有价值——下个 Agent 从 prompt 起步比从 handoff 全文起步更快
- 评审清单要写到"如何验证"（命令或路径），不是只写"已完成"——这样下个 Agent / 答辩老师都能直接复跑
