# docs 目录说明

`docs/` 是 AgentHub 的项目知识库，用来沉淀产品设计、技术设计、阶段实施计划、AI 协作记录规则和开发中发现的零散问题。

它的目标不是保存完整聊天记录，而是把人与 AI 结对编程过程中形成的**可复用决策、计划、状态池和交接材料**整理成稳定文档。项目完成后，本目录也应能作为一套可复用的 AI 协作开发工作流样板。

## 目录结构

```txt
docs/
├── README.md                    # 本文件：docs 总入口和使用规则
├── design/                      # 产品、交互、技术和实施计划
│   ├── README.md
│   ├── 要求.md
│   ├── prd初版.md
│   ├── ExecutePlan/
│   │   └── V1-单聊完整版实施计划.md
│   └── prototypes/
│       └── v1/
├── state/                       # 小问题、小优化、待修复项
│   ├── README.md
│   ├── TODO.md
│   └── TOFIX.md
└── memo/                        # 人类思考笔记，AI 不主动读取
    └── README.md
```

## 各目录用途

### `docs/design/`

放稳定的产品设计、交互设计、技术设计和实施计划。

适合放：

- PRD、需求说明、课题要求
- UI 原型、交互说明、前端 handoff
- 技术架构、数据模型、API 契约
- 分阶段实施计划，例如 V1 / V2 / V3 的 phase 拆分
- 阶段验收清单和 review checklist

不适合放：

- 临时 bug 列表
- 未整理的聊天记录
- 已经废弃但没有价值的中间草稿

### `docs/design/ExecutePlan/`

放可以直接交给 AI Agent 执行的阶段计划。

这类文件应包含：

- 当前版本目标
- 明确的 scope 和禁止事项
- phase 拆分
- 每个 phase 的工作内容和验收标准
- 目录结构和关键接口约定

后续 Agent 接手开发时，应优先读取这里的实施计划，而不是从聊天历史里推断任务。

### `docs/design/prototypes/`

放 UI 原型和原型 handoff。

原型用于表达信息架构、入口位置、交互规则和关键状态。正式实现时应组件化重写，不直接复制 HTML 到生产代码。

### `docs/state/`

放主线之外的状态池。

- `TODO.md`：小目标、小优化、补充事项。
- `TOFIX.md`：bug、回归、技术债、体验问题。

`docs/state/` 不记录主线阶段进度。主线阶段仍以根目录 `roadmap.md` 和 `docs/design/ExecutePlan/` 为准。

条目写入和完成规则见 `docs/state/README.md`。项目内可使用 `.codex/skills/state-todo` 和 `.codex/skills/state-tofix` 辅助管理。

### `docs/memo/`

放人类思考笔记、脑暴、会议记录和粗略推理。

AI 智能体默认不主动读取这个目录。只有用户明确要求“读取 memo”“把 memo 整理成正式设计”时，才可以读取。

如果 `memo/` 中出现可执行决策，应整理后提升到 `roadmap.md`、`docs/design/` 或 `docs/state/`。

## AI 协作使用方式

### 新 Agent 开始工作时

推荐阅读顺序：

1. 根目录 `AGENTS.md`
2. 根目录 `roadmap.md`
3. `docs/README.md`
4. 当前任务相关的 `docs/design/ExecutePlan/*.md`
5. 相关原型 handoff，例如 `docs/design/prototypes/v1/HANDOFF.md`
6. 必要时读取 `docs/state/TODO.md` 或 `docs/state/TOFIX.md`

不要默认读取 `docs/memo/`。

### 做 phase 开发时

- 只做实施计划中指定的 phase。
- 每个 phase 完成后运行已有的类型检查、build、lint 或 test。
- 如果发现非阻塞问题，按规则记录到 `docs/state/TOFIX.md`。
- 不把主线进度写进 `docs/state/`。

### 做 review 后

- 只记录真实 bug、回归、边界问题、缺失测试或技术债。
- 如果暂不修复，使用 `.codex/skills/state-tofix` 按格式写入 `docs/state/TOFIX.md`。
- 保留 P1/P2/P3 等优先级评级。

### 做小优化 backlog 时

- 主线之外的小优化使用 `.codex/skills/state-todo` 写入 `docs/state/TODO.md`。
- 如果事项已经属于版本主线，应提升到 `roadmap.md` 或 `docs/design/ExecutePlan/`，不要放进 `TODO.md`。

### 上下文快满或换 Agent 时

使用 `.codex/skills/project-handoff` 生成 handoff。

handoff 应包含：

- 当前阶段和 phase
- 已完成和未完成事项
- 修改过的文件
- 验证命令和结果
- 风险、阻塞和下一步
- 可直接复制给下一个 Agent 的继续执行 prompt

## 文档沉淀原则

- 文档记录决策，不记录噪音。
- 主线计划放 `roadmap.md` 和 `docs/design/ExecutePlan/`。
- 设计决策放 `docs/design/`。
- 小问题和后续修补放 `docs/state/`。
- 人类自由思考放 `docs/memo/`。
- 完整聊天记录不进入 docs。
- 文档应能让下一个 AI Agent 在没有旧对话上下文的情况下继续工作。
