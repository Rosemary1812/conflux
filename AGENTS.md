# AgentHub 智能体协作指南

本文件是 AI 编程智能体的共享项目指令入口。内容保持简洁、可执行。产品细节放在 `docs/`，零散问题和小修补项放在 `docs/state/`，仅供人类记录思考的内容放在 `docs/memo/`。

## 项目定位

- 产品名：AgentHub / Conflux。
- 核心体验：以 IM 聊天为核心交互范式的多 Agent 协作平台。
- V1 目标：单聊完整可用（前后端 + Agent 接入 + IM 体验）；群聊仅静态 UI（见 `roadmap.md`）。
- 主要交付价值：可运行产品演示，以及可追溯的 AI 协作开发流程。

## 开发顺序

除非人类明确调整阶段，否则按 `roadmap.md` 推进：

1. V1：单聊端到端（前后端 + SQLite + SSE + 1～2 个真实适配器 + 右栏/产物/消息操作）；群聊页面用静态或模拟数据，不接 Orchestrator。
2. **V1.5**：单聊跑通 Approval + 选项交互（同一 run 可 pause/resume）；契约预留群聊字段。详见 `docs/design/ExecutePlan/V1.5-交互桥接-Approval与选项.md`。
3. V2：群聊与 Orchestrator 联调（复用 V1.5 交互 API/SSE；群聊 UI 接 Approval/Choice）。
4. V3：自建 Agent、Skill、Diff/部署等增强。

V1 不要实现群聊真实调度、Orchestrator、Skill；群聊 UI 可先行，后端按单聊建模即可。**V2 启动前须完成 V1.5。**

## 文件所有权规则

- UI Shell 工作负责 `app/`、`components/`；单聊接 API，群聊静态页可用 `lib/mock/` 或组件内模拟数据。
- DB/API 工作负责 `lib/db/`、`app/api/conversations/` 和 `app/api/messages/`。
- 适配器工作负责 `lib/adapters/` 和适配器契约类型。
- Orchestrator 工作负责 `lib/orchestrator/`，只能依赖适配器接口。
- 评审/QA 工作应将发现写入 `docs/state/TOFIX.md`，不要直接做大范围重构。

多个 AI 智能体并行开发时，按“文件所有权 + 接口契约”拆分，不按模糊的前端/后端标签粗拆。

## 文档规则

- `roadmap.md`：阶段计划和优先级。
- `docs/design/`：产品设计、交互设计、技术设计、API 契约。
- `docs/state/TODO.md`：主线之外的小目标、小优化和后续补充项。
- `docs/state/TOFIX.md`：零散 bug、技术债、回归和体验问题。
- `docs/memo/`：人类思考笔记。智能体不得主动阅读，除非用户明确要求。

不要用 `docs/state/` 记录主线进度。`TODO.md` 和 `TOFIX.md` 的每个条目都必须包含时间、所属范围、问题/目标、解决方案、涉及修改文件和验收标准。条目完成后，从同一文件的 `待做` 移到 `已做`。不要把完整聊天记录粘贴进文档。

## 评审门

每个功能完成后都应通过以下检查：

1. 功能验收：是否满足当前阶段检查清单。
2. 类型/构建/lint：在项目已有对应命令时执行。
3. AI 评审：只审 bug、边界、退化和缺失测试，不做无关重构。
4. 人工决策：立即修复，或记录到 `docs/state/TOFIX.md`。

## 当前约束

- V1 保持 Web 优先，不引入 Electron。
- V1 本地优先演示使用 SQLite。
- Orchestrator 保持仓库内自研，便于解释和答辩。
- 保持代码可读性，避免大面积无解释的 AI 重写。
