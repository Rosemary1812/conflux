# Handoff

## 当前

- 仓库：`D:\coding\agent\AgentHub`
- 分支：`main`
- 阶段：V3 自建 Agent 计划 v7 已定稿，未启动实施
- git：3 个 untracked 文档文件，0 个 commit。下一 Agent 进门前先决定怎么处理这 3 个文件（建议先 commit `docs(design): V3 计划 v7 + SDK 调研`，避免被后续编辑污染）

## 上轮做了什么

完成 V3 自建 Agent 计划（v1 → v7），并完成 Claude Agent SDK 工具集机制调研。8 个开放问题全部 ✅ 已定；§七 拆 9 个 Phase（V2.6 / V3.0 / V3.1 / V3.2 / V3.3 / V3.4 / V3.5 / V3.6 / V3.7），含 🟢/🟡/🔴 难度标记与 C0 设计稿要求。详见交付物。

## 主交付物（先读这些）

| 文件 | 用途 |
|------|------|
| `docs/design/ExecutePlan/V3-自建Agent与基础收口.md` | **v7 计划**。重点：§六 8 个决策；§七 9 个 Phase + 难度速查 + 依赖图；§八 验收；§四 明确不做 |
| `docs/memo/2026-06-07-claude-sdk-toolset-research.md` | SDK 调研依据（profile 映射表、canUseTool 签名、permissionMode 行为对比） |
| `AGENTS.md` | 文件所有权 + 文档规则 + 评审门 |
| `roadmap.md` §V3（122–139 行） | 阶段总目标与验收 |

辅助（按需读）：

- `docs/design/ExecutePlan/V1.5-交互桥接-Approval与选项.md` §5.3 — V3.7 Approval 桥接的依赖（`run-bridge` 入口）
- `docs/state/TOFIX.md` / `TODO.md` — 主线之外的问题

## 接下来做什么

**推荐先开 🟢 V2.6 搜索会话收口**（半天试刀）。理由：

- 9 个 Phase 里最简单，半天跑通
- 验证难度标记系统对 Agent 是不是真有效、commit 粒度合不合理
- 试刀暴露的灰色地带会成为 V3.0+ 设计稿补全依据

跑完 V2.6 后，按 §七 依赖图主线推进：V3.0 → V3.1 → V3.2 → V3.4 → V3.5，并行支线 V3.3 / V3.6 / V3.7 在依赖就位后各自启动。

**如果用户想跳过试刀**：直接进 🟢 V3.0 数据模型（migration 是后续 Phase 基础）。

## 关键约束

- 🟢 Phase：直接做，**不写 C0 设计稿**
- 🟡 Phase：实现前**先写 C0 设计稿**（types / 状态机转移表 / API 字段 / UI 组件 props），提交为独立 `docs(plan): Vx.x design draft` commit；设计稿就绪后再进 C1+ 实现
- 🔴 V3.7：C0 必须含**与 V1.5 run-bridge / V3.4 adapter 的对齐方案（伪代码）**；C0 完成后**先在对话中与用户对齐**再进 C1
- 单聊主链路必须保持不退化
- 不重写 V1.5 / V2 / V2.5 已落地的代码

## 风险提示

1. **V3.7 必须与用户对齐**——C0 设计稿写完不能直接进 C1
2. **V3.0 migration 兼容性**——agents 加 7 列需幂等 `ALTER TABLE`，旧数据不能丢。实施前备份旧 DB 验证
3. **Planner Provider 依赖**——V3.2 / V3.4 / V3.6 涉及 LLM 调用，依赖 `ORCHESTRATOR_*` env 或设置页 Provider。开工前确认可用（默认 MiniMax-M3 已跑通）
4. **Q10 base_url 格式**——A 方案先行（不转换 + UI 标注）；跑出 401/404 再升级 B（自动 strip `/v1`）

## 给下一个 Agent 的 prompt

```text
你在 D:\coding\agent\AgentHub 仓库工作。

读 AGENTS.md，然后读 docs/design/ExecutePlan/V3-自建Agent与基础收口.md
（重点 §六 决策、§七 Phase 与难度标记、§四 明确不做、§八 验收）。

当前任务：开 🟢 V2.6 搜索会话收口（半天试刀）。

V2.6 的"工作"与"验收"在 V3 计划 §七 V2.6 段。commit 怎么拆、commit
message 怎么写、代码怎么组织，你自行决定。最后跑 npm run typecheck 和
npm run build。

完成后在对话中汇报：commit 列表、typecheck/build 结果、单聊回归是否通过、
试刀过程中计划没说清楚的地方（用于回头补 V3.0+ 设计稿）。

只做 V2.6，不要扩大范围到 V3.0 / V3.1，也不要重写 V3 计划文档。
```
