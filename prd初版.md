# Conflux 产品需求文档 (PRD)

**产品名**: **Conflux**（多 Agent 汇流协作）  
**课题名**: AgentHub（与 `要求.md` 一致，交付/答辩材料可并用「AgentHub · Conflux」）  
**版本**: v0.1  
**状态**: 草稿  
**作者**: Lynn  
**最后更新**: 2026-05-20

---

## 一、产品概述

### 1.1 产品定位

Conflux 是一个以 **IM 聊天为核心交互范式**的多 Agent 协作平台。用户像使用微信/飞书一样，通过新建对话、发送消息的方式与不同 AI Agent 进行交互，同时在右侧面板实时感知 Agent 的执行状态和产出产物。

平台接入的是 **Agent 产品/运行时**（如 Claude Code、Codex、Hermes、OpenClaw），而非仅对接单一厂商的 Chat API。Conflux 通过 **适配器层** 把各平台不同的调用方式、鉴权与事件格式，统一成平台内部的一套会话协议；**不要求**所有 Agent 共用同一家 API Key。

### 1.2 核心价值


| 价值点        | 描述                                                      |
| ---------- | ------------------------------------------------------- |
| 熟悉的交互范式    | IM 聊天界面，零学习成本                                           |
| 多 Agent 协同 | 群聊模式下多个 Agent 并行分工，Orchestrator 自动调度                    |
| 多平台统一入口    | 在 IM 里同时驱动 Claude Code、Codex 等本机已配置的 Agent，无需为每个平台单独开终端 |
| Skill 扩展     | `/agent-creator`、`/skill-creator` 等斜杠命令，对话式创建 Agent 与 Skill |
| 产物可见       | 代码、网页等产物直接内联在聊天流中预览                                     |
| 执行透明       | 右侧面板实时展示 Agent 状态、任务进度、产出文件                             |


### 1.3 目标用户

开发者、产品经理、内容创作者等需要借助 AI 完成复杂任务的用户，尤其是希望同时驱动多个 AI Agent 并行工作的重度 AI 用户。

---

## 二、整体架构

### 2.1 三栏布局

```
┌─────────────┬──────────────────────────┬──────────────────┐
│  会话列表    │       消息流              │   会话上下文面板  │
│  200px      │       flex-1             │   280px          │
│             │                          │                  │
│ [+ 新建对话] │  [消息气泡]               │ Agent 状态       │
│ • 会话 A    │  [Agent 回复流]           │ Todo 进度        │
│   🤖 Claude │  [产物预览卡片]           │ 产出文件列表      │
│ • 会话 B    │  [输入框]                 │ 上下文用量        │
│   🤖×3 群聊 │                          │                  │
└─────────────┴──────────────────────────┴──────────────────┘

```

- **左侧仅会话列表**，无独立「Agent 通讯录」。与哪个 Agent 聊，在 **新建对话** 时选择；已建会话的参与 Agent 固定（单聊 1 个 / 群聊多个），体现在会话条目头像与消息流中。
- **新建对话**：弹层/向导 → 选单聊或群聊 → 勾选 Agent（内置 + 自建）→ 创建后会话出现在左侧列表。

### 2.2 技术栈

**全栈 TypeScript，本地优先**：单仓库、单语言，适配器/Orchestrator/Skill 与 IM 共用类型定义。

| 层级 | 选型 | 理由 |
| ---- | ---- | ---- |
| 应用 | Next.js 14 + TypeScript（App Router） | 页面 + `app/api` Route Handlers，SSE 流式原生支持 |
| UI | shadcn/ui + Tailwind CSS | 三栏 IM、弹层、列表快速搭建 |
| 代码编辑器 | Monaco Editor | 全屏代码编辑（P1 可延后，P0 消息内用 Shiki 即可） |
| 代码高亮 | Shiki | 消息流内代码块渲染 |
| Diff 视图 | diff2html | P2；与 Monaco Diff 二选一 |
| 数据访问 | Drizzle ORM | 类型安全 schema，与 SQLite / PostgreSQL 可切换 |
| 数据库（默认） | **SQLite**（`better-sqlite3`） | 本地单文件库，契合「命令行启动 → 本机使用」 |
| 数据库（可选） | PostgreSQL | 仅在未来「中心服务 / 多人共享库」模式启用 |
| 实时通信 | **SSE**（P0 主通道） | Agent/Skill 流式输出、任务状态推送 |
| 实时通信（P1） | WebSocket | 在线状态、多端同步等，P0 不引入 |
| 进程集成 | Node `child_process` | spawn 本机 Claude Code / Codex 等 CLI，解析 stdout |
| 桌面客户端（P1） | **Electron** | 主进程为 Node，便于内嵌启动 Next 子进程；见 §2.4 |

**选型说明（SQLite vs PostgreSQL）**：

- 本产品默认 **数据落在本机**（如 `~/.conflux/conflux.db`），单用户为主 → **SQLite 更合适**，无需单独起数据库服务。
- **PostgreSQL** 留给后续「团队服务器部署、多人共库」；P0 Demo 不依赖 Docker 中的 Postgres。

### 2.3 本地运行形态（P0）

```bash
# 用户侧典型流程
pnpm conflux start    # 或 npm run start / 全局 CLI：conflux start
# → 启动 Next 服务（默认 http://127.0.0.1:3000）
# → 自动打开系统默认浏览器
```

| 项 | 说明 |
| ---- | ---- |
| 进程模型 | 本机 **一个 Node 进程**（Next 生产/开发服务器）承载 UI + API |
| 数据目录 | `~/.conflux/`：`conflux.db`、导出 Skill、会话附件等 |
| 客户端形态 | P0：**CLI + 系统浏览器** |
| 与云部署关系 | 课题 Demo 以本地跑通为主；云上部署为 P2，可切换 `DATABASE_URL` 至 PostgreSQL |

**建议仓库结构（P0）**：

```
Conflux/
├── app/                 # 页面 + app/api/* Route Handlers
├── components/
├── lib/
│   ├── adapters/        # ClaudeCodeAdapter、CodexAdapter…
│   ├── orchestrator/
│   ├── skills/
│   └── db/              # Drizzle schema + 连接
├── skills/builtin/      # agent-creator、skill-creator
├── drizzle/             # migrations
├── bin/                 # conflux CLI（start / dev）
└── package.json
```

### 2.4 桌面客户端（P1 · Electron）

P1 在 **不改动 Web 前端与 API** 的前提下，用 **Electron** 提供可安装的桌面应用（`.exe` / `.dmg`）。**不选 Tauri**：Conflux 依赖 Node 子进程（Next 服务 + CLI 适配器），Electron 主进程同为 Node/TS，集成成本最低。

#### 2.4.1 用户感知

| P0 | P1 |
| ---- | ---- |
| 终端执行 `conflux start`，浏览器打开 | 双击 **Conflux** 图标，独立窗口打开（无地址栏） |
| 需记得关终端/进程 | 关窗口即退出应用（主进程负责清理子进程） |

#### 2.4.2 进程架构

```
┌─────────────────────────────────────────┐
│  Electron 主进程（electron/main.ts）       │
│  · spawn Next standalone / next start   │
│  · 等待 http://127.0.0.0:<port> 就绪     │
│  · 创建 BrowserWindow 加载上述 URL       │
│  · 退出时 kill Next 子进程               │
└─────────────────┬───────────────────────┘
                  │ 同源 Web UI
┌─────────────────▼───────────────────────┐
│  Next（子进程）· UI + app/api + SSE       │
│  SQLite：~/.conflux/conflux.db        │
└─────────────────────────────────────────┘
```

- **不**把 Next 编译成纯静态页（API Routes / SSE 仍需 Node 服务）。
- 推荐 P1 构建链：`next build` → `output: 'standalone'`，由 Electron 主进程启动 `standalone/server.js`。
- 端口：默认 `3000`，冲突时自动递增或读 `~/.conflux/config.json`。

#### 2.4.3 仓库增量（P1）

```
electron/
├── main.ts          # 启停 Next、窗口生命周期、单实例锁
├── preload.ts       # 可选：暴露 openPath、选工作目录 native dialog
└── tsconfig.json
```

- 打包：**electron-builder**（Windows NSIS、macOS dmg；Linux AppImage 可选）。
- 开发：`concurrently` — `next dev` + `electron .`（开发时窗口指向 `localhost:3000`）。

#### 2.4.4 P1 验收口径

- Windows 上安装包可安装、可启动，窗口内完成：登录后新建会话 → 单聊流式回复。
- 退出应用后无残留 Next/node 进程（主进程 `before-quit` 清理）。
- 数据仍落在 `~/.conflux/`，与 P0 CLI 模式 **共用同一数据库**。

#### 2.4.5 为何不用 Tauri（记录决策）

| 维度 | Electron | Tauri |
| ---- | -------- | ----- |
| 主进程 | Node/TS，与项目栈一致 | Rust，需 sidecar 托管 Node |
| 集成 Next + spawn CLI | 直接 `child_process` | 额外打包与通信 |
| 安装包体积 | 较大（可接受 P1） | 较小 |

若未来极度追求体积，再评估 Tauri + Next standalone sidecar；**P1 不做**。

---

## 三、功能详细设计

### 3.1 左侧：会话列表面板

#### 3.1.1 会话列表

- 按最近活跃时间倒序排列
- 每条会话显示：**参与 Agent 头像**（单聊 1 个 / 群聊多个叠放）、会话名称、最后一条消息摘要、未读数角标、时间戳
- 支持操作：置顶、归档、删除、重命名（**不含**在列表里切换 Agent；要换 Agent 需新建对话）
- 顶部 **「+ 新建对话」** 按钮（见 §3.1.2）
- 支持搜索（**P1**）：关键词搜索会话名称和消息内容

#### 3.1.2 新建对话（选择 Agent）

点击左侧「+ 新建对话」打开创建向导（弹层），**不在左侧展示 Agent 列表**：

1. **选择模式**：单聊 / 群聊
2. **选择参与 Agent**：从可选列表中勾选（展示头像、名称、能力标签）
  - 内置：Claude Code、Codex、Hermes、OpenClaw 等（见 §3.1.3）  
  - 自建：用户已通过 §3.6 创建的 Agent  
  - 群聊：至少选 2 个执行 Agent；Orchestrator 由平台在群聊中自动启用，无需用户勾选
3. **确认创建**：生成会话并进入中间消息流；左侧列表新增该会话条目

向导内可提供 **「+ 新建 Agent」** 入口，等价于在新会话中发送 `/agent-creator`（§3.6 / §3.7），创建完成后回到向导继续勾选。

#### 3.1.3 可接入 Agent 清单（规划）


| Agent 名称     | 背后平台 / 运行时                                                        | 鉴权与配置来源                                          | 能力标签                | 优先级 |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------ | ------------------- | --- |
| Claude Code  | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI | **继承本机** `claude` 已登录账号 / 环境变量 / 项目配置            | 代码生成、仓库操作、工具调用      | P0  |
| Codex        | OpenAI Codex CLI                                                  | **继承本机** Codex / OpenAI 凭据与配置文件                  | 代码生成、脚本执行           | P0  |
| Hermes       | Hermes Agent 运行时                                                  | **继承本机** Hermes 配置                               | 待定（按 Hermes 能力标签）   | P0  |
| OpenClaw     | OpenClaw 运行时                                                      | **继承本机** OpenClaw 配置                             | 待定（按 OpenClaw 能力标签） | P0  |
| Orchestrator | **平台自研 `OrchestratorService`**（见 §6.4；群聊自动启用，不在新建对话中勾选） | `OrchestratorPlanner` 使用 `.env` 中的 OpenAI 兼容 LLM 端点 | 任务编排、多 Agent 调度     | P0  |


> **与课题要求对齐**：P0 接入 **Claude Code、Codex、Hermes、OpenClaw** 四个 Agent 平台（满足课题「至少 2 个主流 Agent 平台」）。

---

### 3.2 中间：消息流面板

#### 3.2.1 消息类型


| 类型        | 渲染方式                              | 优先级    |
| --------- | --------------------------------- | ------ |
| 文本        | Markdown 渲染，支持加粗、列表、链接            | P0     |
| 代码块       | Shiki 语法高亮，显示语言标签，一键复制            | P0     |
| 图片        | 缩略图 + 点击放大；用户上传或 Agent 返回的图片      | **P0** |
| 文件附件      | 文件名、大小、类型图标，支持下载                  | **P0** |
| 网页预览卡片    | sandboxed iframe，支持展开全屏           | P0     |
| 任务进度卡片    | 子任务列表 + 实时状态（待执行 / 进行中 / 完成 / 失败） | P0     |
| 产物卡片      | 文件名 + 类型图标 + 预览按钮 + 下载按钮          | P0     |
| Diff 视图卡片 | diff2html 渲染，支持一键应用               | **P2** |
| 错误卡片      | 红色边框，错误信息 + 重试按钮                  | P0     |


#### 3.2.2 消息操作

- **重新生成**（P0）：重新调用 Agent，清除当前回复
- **复制**（P0）：复制消息文本或代码块内容
- **引用回复**（**P0**）：引用某条消息后继续对话；群聊中引用可携带被 @ 的 Agent 上下文，便于多 Agent 协作时定点追问
- **展开产物**（P0）：点击产物卡片进入全屏预览/编辑模式

#### 3.2.3 输入框

- 支持多行文本输入
- 支持 `@AgentName` 语法，在群聊中指定 Agent
- 支持 **斜杠命令** 调起 Skill（**P0**，见 §3.7）：
  - 输入 `/` 弹出 Skill 补全列表（内置 + 自建）
  - 格式：`/<skill-slug>` 或 `/<skill-slug> 附加说明`（如 `/agent-creator 做一个只改 React 的 Agent`）
  - 发送后由 `SkillRunner` 接管本轮及后续多轮，直至 Skill 流程结束或用户 `/cancel`
- 支持文件上传（**P0**：图片、常见文本/代码附件）
- 发送快捷键：`Cmd/Ctrl + Enter`
- 输入框下方状态条：当前会话绑定的 Agent / 平台；**Skill 激活时**显示 `正在运行：/<slug>`

#### 3.2.4 流式输出

- Agent 回复以流式方式逐字渲染，有打字光标效果
- 流式过程中显示 Agent 头像 + "正在输入..." 状态
- 支持中途停止生成

---

### 3.3 右侧：会话上下文面板

右侧面板内容**跟随左侧当前选中的会话**，切换会话时面板内容同步更新。

#### 3.3.1 单聊模式下的面板

**Agent 状态区**

- Agent 头像 + 名称
- 当前状态：`空闲` / `思考中` / `执行中` / `等待确认`
- 当前执行的操作描述（如 "正在读取 [main.py](http://main.py)..."）

**Todo 进度区**

- Agent 在回复中自动生成的子任务列表
- 每项显示状态图标（圆圈/进行中/勾选）
- 实时更新，Agent 完成一项自动勾选

**产出文件区**

- 本次会话中 Agent 生成的所有文件
- 显示：文件名、类型、生成时间
- 点击预览，支持代码文件在 Monaco Editor 中打开

**上下文用量区**

- 进度条显示当前 context window 使用量
- 分类标注：技能 / 联网搜索 / 文件 / 其他（参考截图设计）

#### 3.3.2 群聊模式下的面板

**多 Agent 状态区**

- 每个参与的 Agent 一行：头像 + 名称 + 当前状态
- 状态颜色：灰色（空闲）/ 蓝色（执行中）/ 绿色（已完成）/ 红色（失败）

**任务分派区**

- Orchestrator 拆解的任务列表
- 每项任务显示：任务描述 + 分派给哪个 Agent + 当前状态

**产出汇总区**

- 所有 Agent 的产出文件统一列出
- 标注来源 Agent

---

### 3.4 会话模式

#### 3.4.1 单聊模式

- **创建时**（§3.1.2）选定唯一 Agent，之后该会话绑定此 Agent
- 消息历史完整传递给 Agent 作为上下文
- 右侧面板展示单 Agent 状态

#### 3.4.2 群聊模式

- **创建时**选定多个执行 Agent；Orchestrator 自动参与编排
- 会话中可通过 `@` 在消息里指定由哪个 Agent 回复；**P1** 再评估是否支持会话中途增删成员 Agent
- 用户发送消息后，Orchestrator 自动分析意图，拆解任务，分派给合适的子 Agent
- **P0**：Orchestrator 分派后，子任务支持 **串行** 与 **并行**（按 `depends_on` 依赖图调度，无依赖可并行）
- **P1**：**失败降级**、**代码冲突处理**（见 §3.4.3）
- 每个 Agent 的回复气泡显示该 Agent 的头像和名称，视觉上区分不同 Agent

#### 3.4.3 Orchestrator 增强能力（P1）

| 能力 | 说明 |
| ---- | ---- |
| 失败降级 | 子 Agent 失败时：重试 → 换 Agent → 由 Orchestrator 代为说明并继续其余任务 |
| 代码冲突处理 | 多 Agent 修改同一文件时，检测冲突；策略：串行合并 / 生成 Diff 供用户确认（与 §3.5.3 Diff **P2** 联动） |

**Orchestrator 工作流（P0）：**

```
用户消息
   ↓
Orchestrator 分析意图
   ↓
输出任务分派 JSON
{
  "tasks": [
    { "agent": "Claude", "task": "写 React 组件" },
    { "agent": "Codex", "task": "写单元测试" }
  ]
}
   ↓
后端解析任务 DAG → 无依赖任务并行、有依赖任务按序执行
   ↓
各 Agent 流式回复展示在消息流中
   ↓
Orchestrator 汇总并发送最终总结

```

---

### 3.5 产物预览与编辑

#### 3.5.1 网页预览

- Agent 生成 HTML/CSS/JS 代码时，自动识别并生成网页预览卡片
- 卡片内嵌 sandboxed iframe，展示渲染效果
- 点击展开按钮进入全屏预览模式
- 全屏模式左侧代码（Monaco Editor），右侧实时预览，支持手动修改代码

#### 3.5.2 代码文件预览

- 代码块支持 Shiki 语法高亮
- 点击"在编辑器中打开"进入 Monaco Editor 全屏编辑
- 编辑后可发送给 Agent 继续修改（"帮我优化这段代码" + 附带编辑后的代码）

#### 3.5.3 Diff 视图（P2）

- Agent 修改已有代码时，自动生成 Diff 视图卡片
- 使用 diff2html 渲染，绿色新增、红色删除
- "一键应用" 按钮：将 Diff 应用到会话的代码状态中

---

### 3.6 自建 Agent（P0）

与课题要求对齐：用户通过 **对话式创建** 定义 Agent，产出 **System Prompt + 工具集**。创建流程由内置 Skill **`agent-creator`** 驱动（§3.7），**非**静态表单。

#### 3.6.1 创建入口（均指向 `/agent-creator`）

- **首选**：任意会话输入框发送 **`/agent-creator`**（可带描述参数）
- **新建对话向导**：「+ 新建 Agent」→ 新建会话并自动发送 `/agent-creator`
- **P1**：自然语言意图识别后建议用户发送 `/agent-creator`（非 P0 必须）

#### 3.6.2 对话内创建流程（`agent-creator` Skill）

激活 `agent-creator` 后，在当前会话（或向导新建的空会话）中进入多轮引导；UI 仍为普通 IM 消息流，由 `SkillRunner` 加载该 Skill 的 `SKILL.md` 指令并调用规划 LLM。

```
用户：/agent-creator 我想做一个只会改 React 组件的 Agent
Skill：好的。它主要用 Claude Code 还是 Codex？需要能执行终端命令吗？
用户：Claude Code，要能读写在项目里改文件
Skill：已生成草案——名称「React 助手」、System Prompt（预览）、工具：read_file / write_file / bash …
用户：再加上不要用 bash 跑安装，只允许改 src 目录
Skill：已更新。确认创建吗？
用户：确认
→ 持久化为自建 Agent，出现在「新建对话」的 Agent 选择列表；会话 `active_skill_id` 清空
```

多轮修订字段：名称、头像、描述、System Prompt、底层平台、能力标签、**工具集**；草稿存 `AgentDraft`，确认后写入 `Agent` 表。

#### 3.6.3 产出字段（创建完成后）


| 字段            | 说明                                           | 收集方式                                   |
| ------------- | -------------------------------------------- | -------------------------------------- |
| 名称            | Agent 显示名称                                   | 对话确认或自动生成                              |
| 头像            | 上传图片 / Emoji / AI 建议                         | 对话中附带或创建后编辑                            |
| 描述            | 一句话能力描述                                      | 由创建引导对话从多轮消息归纳                        |
| System Prompt | 完整系统提示词                                      | 多轮迭代，支持预览 diff                         |
| 底层平台          | Claude Code / Codex / Hermes / OpenClaw（四选一） | 对话中选择                                  |
| 工具集 `tools`   | 该 Agent 允许使用的工具 ID 列表                        | 对话勾选 + 自然语言（「要能搜网页」→ 映射到 `web_search`） |
| 能力标签          | 选择器中的 Agent 卡片展示                             | 自动打标 + 用户可改                            |


**工具集（`tools`）定义**：

- 与底层平台能力取交集：例如 Claude Code 适配器声明可用工具，自建 Agent 从中勾选子集
- 内置工具示例：`read_file`、`write_file`、`bash`、`grep`、`web_search`、MCP 服务（按平台暴露）
- 存储为 JSON 数组；执行时由适配器将列表传给对应 CLI/SDK
- **P0 最小集**：至少支持勾选 3～5 个内置工具；复杂 MCP 扩展放 P1

#### 3.6.4 创建后的使用

- 创建完成后出现在 **新建对话 → 选择 Agent** 列表中；可被拉入群聊、被 Orchestrator 分派
- **P1**：对已有自建 Agent 再次发送 `/agent-creator <agent_id>` 进入编辑流程

---

### 3.7 Skill 与斜杠命令（P0）

#### 3.7.1 Skill 是什么

**Skill** 是一份可复用的 **`SKILL.md` 指令包**（YAML frontmatter + Markdown 正文），教平台在特定场景下如何多轮引导用户、调用工具、写出产物。与 **用户自建 Agent** 区分：

| 维度 | Skill | 自建 Agent（§3.6） |
| ---- | ----- | ------------------ |
| 触发 | 斜杠命令 `/slug` | 被选中后作为会话的执行者 |
| 产物 | 新的 `Skill` 记录或完成一次工作流 | 持久化的 Agent（Prompt + 工具集 + 平台） |
| 运行方式 | `SkillRunner` 短期接管会话 | `AgentAdapter.run()` 长期执行用户任务 |
| 典型用途 | 创建 Agent、创建 Skill、团队规范检查 | 写代码、写文档、群聊子任务 |

#### 3.7.2 斜杠命令

- 以 `/` 开头，紧跟 **skill slug**（小写、连字符，如 `agent-creator`）
- 可选尾部自然语言参数：`/skill-creator 写一个 PR 审查 skill`
- 解析优先级：先匹配 Skill → 否则当作普通用户消息（P0 不支持自定义 slash 别名）
- 会话字段 `active_skill_id`：Skill 运行期间非空，结束后置空
- 用户可随时发送 **`/cancel`** 退出当前 Skill（P0）

#### 3.7.3 内置 Skill（P0，不可删除）

| Slug | 命令 | 作用 | 产出 |
| ---- | ---- | ---- | ---- |
| `agent-creator` | `/agent-creator` | 对话式创建/编辑自建 Agent（§3.6） | `Agent` + `tools[]` + `system_prompt` |
| `skill-creator` | `/skill-creator` | 对话式创建/编辑用户 Skill | `Skill` 记录 + `SKILL.md` 正文写入存储 |

二者均为平台内置 `is_builtin=true`，正文存于仓库 `skills/builtin/<slug>/SKILL.md`（可版本化），运行时由 `SkillRunner` 读取。

**`skill-creator` 流程概要**：

1. 询问 Skill 用途、触发场景、存放范围（项目 `.cursor/skills/` / 用户目录）
2. 多轮生成 `name`、`description`、正文草案，支持预览
3. 用户确认后写入 `Skill` 表，并导出到目标路径（P0 可先落库 + 提供下载/复制；P1 自动写文件）

**`agent-creator` 流程概要**：见 §3.6.2。

#### 3.7.4 SkillRunner（自研）

```
POST /messages 检测到 content 以 / 开头
    ↓
SkillRegistry.resolve(slug)
    ↓
SkillRunner.start(conversation_id, skill_id, user_args)
    ├── 注入：Skill 正文 + 会话摘要 + 领域上下文（创建 Agent 时传入可选 Agent 列表）
    ├── 多轮 LLM 引导（共用 OrchestratorPlanner 同类 LLM 端点，**Prompt 来自 SKILL.md**）
    └── on_complete → 写入 Agent / Skill 表，推送系统消息「创建成功」
```

- **与 Orchestrator 分离**：Orchestrator 仅群聊分派；Skill 仅响应斜杠命令，**互不替换**。
- **与自建 Agent 执行分离**：Skill 运行时的 LLM 只服务于「创建流程」；创建完成的 Agent 之后用 **用户定义的 Prompt + 工具集** 执行。

#### 3.7.5 更多 Skill 能力（P1）

- 导入已有 `SKILL.md`、编辑/删除自建 Skill
- `/` 补全列表展示全部自建 Skill（P0 创建完成后即可用，P1 完善管理 UI）
- slug 唯一性校验；禁止与内置 slug 冲突

---

## 四、数据模型

### 4.1 核心实体

```
User
├── id
├── name
└── created_at

Agent
├── id
├── name
├── avatar_url
├── description
├── system_prompt
├── platform        (claude_code | codex | hermes | openclaw | custom)
├── platform_config (JSON, 可选覆盖：CLI 路径、工作目录、API 覆盖项等)
├── model_name      (可选，平台内具体模型名)
├── tags            (JSON array)
├── tools           (JSON array, 工具集 ID 列表，自建 Agent 必填)
├── is_builtin      (bool)
└── created_by      (User.id, null if builtin)

Skill
├── id
├── slug              (唯一，如 agent-creator、my-pr-review)
├── name
├── description       (frontmatter 摘要，供 / 补全展示)
├── content           (SKILL.md 全文)
├── scope             (project | user)
├── storage_path      (可选，导出目标路径)
├── is_builtin        (bool)
└── created_by        (User.id, null if builtin)

AgentDraft  (/agent-creator 运行中的草稿)
├── id
├── user_id
├── conversation_id
├── skill_run_id      (可选)
├── draft_payload     (JSON: 未确认的 name / prompt / tools 等)
└── updated_at

SkillDraft  (/skill-creator 运行中的草稿，结构类似 AgentDraft)

Conversation
├── id
├── title
├── mode              (single | group)
├── active_skill_id   (FK → Skill.id，斜杠命令运行中非空)
├── created_by        (User.id)
├── is_pinned
├── is_archived
└── created_at

ConversationAgent  (会话中的 Agent 成员)
├── conversation_id
└── agent_id

Message
├── id
├── conversation_id
├── sender_type     (user | agent | system | skill)
├── sender_id       (User.id or Agent.id or Skill.id)
├── skill_run_id    (可选，Skill 运行期间关联)
├── content         (Markdown 文本)
├── artifacts       (JSON array, 产物列表)
├── status          (sending | streaming | done | error)
└── created_at

Artifact
├── id
├── message_id
├── type            (code | webpage | file | diff | task_list)
├── content         (JSON, 根据 type 结构不同)
└── created_at

Task  (Orchestrator 拆解的子任务)
├── id
├── conversation_id
├── message_id      (触发任务的用户消息)
├── assigned_agent_id
├── description
├── status          (pending | running | done | failed)
└── created_at

```

---

## 五、API 设计

### 5.1 会话相关

```
GET    /api/conversations              获取会话列表
POST   /api/conversations              新建会话
GET    /api/conversations/:id          获取会话详情（含消息历史）
PATCH  /api/conversations/:id          更新会话（重命名/置顶/归档）
DELETE /api/conversations/:id          删除会话

```

### 5.2 消息相关

```
GET    /api/conversations/:id/messages      获取消息列表
POST   /api/conversations/:id/messages      发送消息（触发 Agent 调用）
DELETE /api/messages/:id                    删除消息
POST   /api/messages/:id/regenerate         重新生成

```

### 5.3 流式输出

```
GET /api/conversations/:id/stream      SSE 端点，订阅当前会话的流式事件

```

**SSE 事件类型：**

```json
{ "type": "message_start", "agent_id": "claude", "message_id": "..." }
{ "type": "text_delta", "message_id": "...", "delta": "你好" }
{ "type": "artifact_created", "message_id": "...", "artifact": {...} }
{ "type": "task_updated", "task_id": "...", "status": "done" }
{ "type": "message_done", "message_id": "..." }
{ "type": "error", "message_id": "...", "error": "..." }
{ "type": "skill_started", "skill_id": "...", "slug": "agent-creator" }
{ "type": "skill_completed", "skill_id": "...", "result": { "agent_id": "..." } }
{ "type": "skill_cancelled", "skill_id": "..." }

```

### 5.4 Agent 相关

```
GET    /api/agents                     获取 Agent 列表（内置 + 自建）
POST   /api/agents                     新建自定义 Agent（一般由 /agent-creator 完成后写入，保留直连 API 供调试）
PATCH  /api/agents/:id                 更新 Agent
DELETE /api/agents/:id                 删除自建 Agent

```

### 5.5 Skill 相关

```
GET    /api/skills                     列表（内置 + 自建），供 / 补全
GET    /api/skills/:slug               获取 Skill 详情（含 content）
POST   /api/skills                     新建（通常由 /skill-creator 完成后写入）
PATCH  /api/skills/:id                 更新
DELETE /api/skills/:id                 删除自建 Skill（内置不可删）
POST   /api/conversations/:id/skill-runs   显式启动 Skill（与发送 slash 消息等价）
DELETE /api/conversations/:id/skill-runs/current   取消当前 Skill（/cancel）

```

### 5.5 WebSocket

```
WS /ws/conversations/:id

```

**用途：** 在线状态同步、消息送达回执、多端消息同步（P1）

---

## 六、适配器层设计

### 6.1 「适配器」指什么？（常见误解澄清）

课题中的 **「统一适配器层，屏蔽各平台 API 差异」**，在 Conflux 中的含义是：


| 误解                                    | 实际设计                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| 所有 Agent 都用同一家 API（例如全走同一 Chat 厂商）    | **否**。每个 Agent 平台保留自己的鉴权与运行时                                                   |
| Conflux 替代本机 Claude Code / Codex 的配置 | **否**。优先 **继承本机已配置好的 CLI/运行时**                                                 |
| 适配器 = 再包一层 OpenAI 兼容 API              | **不完全是**。适配器对接的是 **Agent 平台的能力边界**（流式文本、工具事件、文件变更、退出码等），不只是 `chat/completions` |


**适配器要做的事**：在 Conflux 内部定义一套稳定的 **会话契约**（发消息、收流、收产物、报状态），各平台适配器负责把契约 **翻译** 成该平台原生调用方式，并把原生事件 **翻译** 回契约。

```
用户消息 (IM)
    ↓
Conflux 会话服务（统一消息 / SSE / Artifact 模型）
    ↓
AgentAdapter（按 platform 选择）
    ├── ClaudeCodeAdapter  → 调用本机 claude code（子进程 / SDK）
    ├── CodexAdapter       → 调用本机 codex CLI
    ├── HermesAdapter      → 调用 Hermes 运行时
    └── OpenClawAdapter    → 调用 OpenClaw 运行时
    ↓
各平台自己的鉴权（本机配置文件 / 环境变量）
```

> Orchestrator 的规划 LLM **不走上述执行 Agent 适配器**，见 §6.4。

**鉴权策略（默认）**：

1. **CLI 类 Agent（Claude Code、Codex、Hermes、OpenClaw）**
  - 启动时检测本机是否已安装、是否已登录/配置  
  - 读取各工具官方配置路径（如用户目录下的 config、env）  
  - Conflux **不强制用户重新填 Key**，除非检测失败时在设置页提供覆盖项
2. **设置页（P1）**
  - 可选：CLI 可执行文件路径、工作区根目录、是否允许 Agent 写盘等，用于覆盖默认检测

### 6.2 统一接口（平台侧契约）

对上层（会话服务 / Orchestrator）暴露的能力，与各厂商原生 API **形状无关**：

```typescript
/** Conflux 内部统一事件，由 SSE 转发给前端 */
type AgentEvent = {
  type: "text_delta" | "tool_start" | "tool_end" | "artifact" | "status" | "error" | "done";
  payload: Record<string, unknown>;
};

interface AgentAdapter {
  readonly platform: "claude_code" | "codex" | "hermes" | "openclaw";

  healthcheck(): Promise<{ ok: boolean; message?: string }>;

  run(params: {
    conversationId: string;
    messages: Array<Record<string, unknown>>;
    systemPrompt?: string;
    workspacePath?: string;
    tools?: string[];
  }): AsyncIterable<AgentEvent>;
}
```

各适配器内部自行处理：子进程调用、stdin/stdout 解析、JSONL 事件、HTTP 流式等差异；**上层不感知**。

### 6.3 计划接入的适配器


| 适配器                 | 对应平台        | 调用方式（倾向）                        | 优先级 |
| ------------------- | ----------- | ------------------------------- | --- |
| `ClaudeCodeAdapter` | Claude Code | 本机 CLI / 官方 SDK，继承已有登录态         | P0  |
| `CodexAdapter`      | Codex       | 本机 Codex CLI，继承 OpenAI/Codex 配置 | P0  |
| `HermesAdapter`     | Hermes      | 按 Hermes 官方集成方式（CLI 或 API）      | P0  |
| `OpenClawAdapter`   | OpenClaw    | 按 OpenClaw 官方集成方式               | P0  |


**P0 验收口径**：Claude Code、Codex、Hermes、OpenClaw 中 **至少 2 个** 各完成一条端到端对话（发消息 → 流式回复 → 产物可在面板展示）；推荐四者均跑通。

### 6.4 Orchestrator 实现

#### 定位：自研编排服务，≠ 用户自建 Agent

**当前倾向（P0）**：**自研 `OrchestratorService`**，而不是把某个已接入的 Claude Code / Codex 当作普通聊天 Agent 来充当编排器。


| 维度            | Orchestrator（平台内置）                          | 用户自建 Agent（§3.6）                |
| ------------- | ------------------------------------------- | ------------------------------- |
| System Prompt | 平台固定、版本化，专用于任务拆解与分派                         | 用户对话式定义，可任意迭代                   |
| 工具集           | 仅编排所需（读 Agent 列表、写 Task 状态等），与用户自选工具 **隔离** | 用户自选 `tools`，经适配器传给对应平台         |
| IM 形态         | 群聊中自动介入；可展示为独立「编排器」系统消息                     | 仅出现在「新建对话」Agent 选择器；创建后作为会话成员展示 |
| 执行路径          | 规划 → JSON 任务表 → 调用各 `*Adapter` 执行子任务        | 单平台适配器 `run()`                  |


#### 自研模块划分（P0）

```
OrchestratorService（平台自研，非用户可选 Agent）
├── OrchestratorPlanner   # 可选：LLM 将用户消息 → 任务 DAG JSON（仅用编排 Prompt）
├── TaskScheduler         # 解析 depends_on，串行/并行调度子任务
├── AdapterInvoker        # 调用 ClaudeCodeAdapter / CodexAdapter 等执行子任务
└── ResultAggregator      # 汇总子 Agent 产出，写入消息流
```

- **执行子任务**时才调用各平台 `*Adapter`，且传入的是 **各 Agent 自己的** System Prompt 与工具集（自建 Agent 为用户在 §3.6 中定义的 Prompt + `tools`）。
- **编排规划**走 `OrchestratorPlanner`，与用户自建 Agent 的 Prompt / 工具集 **完全隔离**。

**不推荐、低优先级（P2 / 远期探索，非 P0/P1）**：把某个已接入 Agent（如 Claude Code）配置为「兼做规划器」。原因：与用户自建 Agent 的「自选 Prompt + 工具集」模型冲突，且易出现改代码与改任务表混在一起。产品默认 **不暴露** 该选项。

#### OrchestratorPlanner 配置（自研子模块，≠ 执行 Agent）

- P0：`OrchestratorPlanner` 通过 **自研 HTTP 客户端** 调用可配置的 OpenAI 兼容 Chat API（`.env`：`ORCHESTRATOR_LLM_BASE_URL`、`ORCHESTRATOR_LLM_API_KEY`、`ORCHESTRATOR_LLM_MODEL`）。
- **不**在 P0/P1 通过 `ClaudeCodeAdapter` / `CodexAdapter` 代为规划；不把「已接入 Agent」当作 Orchestrator 本体。

#### 编排 System Prompt（仅 OrchestratorPlanner，≠ 自建 Agent）

> **边界**：以下 Prompt **只**用于群聊编排；**绝不**写入用户自建 Agent 记录，也 **不**覆盖用户为自建 Agent 配置的 System Prompt / 工具集。

```
你是 Conflux 内置任务编排器（OrchestratorPlanner）。你只输出任务分派 JSON，不执行代码、不调用用户工具。

输入包括：
- 用户最新消息与会话摘要
- 当前会话已选执行 Agent 列表（id、名称、能力标签、平台类型）
- 各 Agent 不可用时的降级标记

你必须：
1. 分析用户意图
2. 拆解为子任务，并为每个子任务指定 agent_id（必须从给定列表中选择）
3. 用 depends_on 表达依赖：无依赖的子任务可并行；有依赖的按序执行
4. 仅输出合法 JSON，不要 markdown 包裹

输出格式：
{
  "analysis": "用户意图简述",
  "tasks": [
    {
      "id": "task_1",
      "description": "子任务描述",
      "agent_id": "agent_uuid",
      "depends_on": []
    },
    {
      "id": "task_2",
      "description": "依赖 task_1 的子任务",
      "agent_id": "agent_uuid",
      "depends_on": ["task_1"]
    }
  ]
}
```

#### Skill 与 Orchestrator 的边界

| 模块 | 触发 | Prompt 来源 | 产出 |
| ---- | ---- | ----------- | ---- |
| `SkillRunner` | `/agent-creator`、`/skill-creator` 等 | 对应 Skill 的 `SKILL.md` | `Agent` / `Skill` 记录 |
| `OrchestratorService` | 群聊用户消息 | 平台固定编排 Prompt（§6.4） | `Task` + 子 Agent 执行 |

用户通过 `/agent-creator` 定稿的 **System Prompt + 工具集** 仅属于自建 Agent；**不**进入 Orchestrator，也 **不**与 `skill-creator` 的 Skill 正文混用。

---

## 七、优先级与里程碑

> 与课题 `要求.md` 对齐后的功能优先级总表（2026-05-20 修订）。


| 功能                                  | 优先级         |
| ----------------------------------- | ----------- |
| 群聊 + Orchestrator（串行 + 并行分派）        | **P0**      |
| 自建 Agent（`/agent-creator` + System Prompt + 工具集） | **P0**      |
| Skill 体系（斜杠命令 + `agent-creator` / `skill-creator`） | **P0**      |
| 消息引用回复（含群聊多 Agent 场景）               | **P0**      |
| 图片消息、文件附件                           | **P0**      |
| 会话搜索                                | **P1**      |
| Orchestrator 失败降级 / 代码冲突处理          | **P1**      |
| Diff 视图卡片 + 一键应用                    | **P2**      |
| **Electron 桌面客户端**（§2.4）              | **P1**      |
| Agent 设置页、版本历史、移动端                  | P1～P2      |


### P0 — 必须完成（Demo 核心）

**布局与单聊**

- 三栏布局框架搭建
- 会话列表：新建、切换、删除、置顶、归档
- 单聊模式：发消息 + 流式回复 + 历史上下文
- 右侧面板：Agent 状态 + Todo 进度 + 产出文件

**多 Agent 核心（课题核心功能）**

- **群聊模式 + Orchestrator**：串行 + 并行分派（`depends_on` DAG）、任务进度卡片、多 Agent 气泡区分
- **消息引用回复**：单聊 / 群聊均可引用，群聊携带被引用消息与相关 Agent 上下文
- **Skill + 斜杠命令**：`SkillRunner`、`/agent-creator`、`/skill-creator`（§3.7）
- **自建 Agent**：经 `/agent-creator` 对话创建（§3.6），产出 System Prompt + **工具集**
- **自建 Skill**：经 `/skill-creator` 对话创建（§3.7.3），产出 `SKILL.md` 落库
- **图片消息 + 文件附件**：上传、渲染、随消息传给 Agent（适配器按平台能力传入）

**平台接入**

- Agent 适配器层：`ClaudeCodeAdapter` + `CodexAdapter` + `HermesAdapter` + `OpenClawAdapter`，本机配置检测与健康检查
- **OrchestratorService** 自研：`OrchestratorPlanner` + `TaskScheduler`（串行/并行）+ 执行 Agent 适配器调用

**消息与产物**

- 消息渲染：文本 Markdown + 代码块高亮 + 网页预览 iframe

### P1 — 完成后体验大幅提升

**桌面发布**

- **Electron 客户端**（§2.4）：`electron/` + electron-builder；Windows `.exe` 安装包（macOS dmg 可选）
- 主进程启动 Next standalone 子进程；`BrowserWindow` 加载本机 Web UI；退出时回收进程
- 与 P0 共用 `~/.conflux/` 与 SQLite

**功能**

- **会话搜索**：会话名 + 消息内容关键词
- **Orchestrator 增强**：失败降级、代码冲突处理（§3.4.3）
- （低优先级）指定已接入 Agent 兼做规划器的实验配置
- Agent 平台设置页（CLI 路径、工作目录、鉴权覆盖）
- 上下文用量进度条
- 自建 Agent / Skill **对话式编辑**（`/agent-creator`、`/skill-creator` 带 id 参数）
- Skill 导出到项目 `.cursor/skills/` 或用户目录（写文件）
- 复杂 MCP 工具接入扩展

### P2 — 时间充裕时做

- **Diff 视图**卡片 + 一键应用（§3.5.3）
- 产物版本历史
- 手动 pin 关键消息为长期上下文
- 移动端轻量客户端；云端部署（PostgreSQL）
- 部署发布、PPT/文档预览等课题【P2】项

---

## 八、AI 协作开发规范

> 本节记录与 AI 协作开发的 Spec，作为交付物的一部分。

### 8.1 开发原则

- **Context First**：每次开始新功能前，向 AI 提供完整上下文（当前文件结构 + 相关接口定义 + 本次目标）
- **增量提交**：每个功能点独立完成后立即提交，保持 git 历史清晰
- **接口先行**：后端接口定义完成后再写前端，避免联调时接口不匹配
- **Skill 即交付物**：仓库需包含 `skills/builtin/agent-creator/SKILL.md` 与 `skills/builtin/skill-creator/SKILL.md`，与课题「Spec / skill / rules」考察点对齐；用户通过 `/skill-creator` 产出的 Skill 同样为可沉淀资产

### 8.2 Prompt 模板

**新功能开发：**

```
背景：Conflux 项目，全栈 TypeScript，Next.js App Router + app/api，Drizzle + SQLite（本地）
当前文件结构：[粘贴目录树]
已有接口：[粘贴相关接口]
本次目标：实现 [具体功能]
要求：[具体技术要求]

```

**Bug 修复：**

```
问题描述：[具体现象]
复现步骤：[步骤]
相关代码：[粘贴代码]
错误信息：[粘贴报错]

```

### 8.3 代码规范

- TypeScript 严格模式；组件 Props、API 入参/出参显式类型，避免 `any`
- 服务端异步统一 `async/await`；子进程使用 `child_process` 并处理超时与销毁
- 数据库变更通过 Drizzle migration 管理，不手改 `conflux.db`
- 提交信息：`feat:` / `fix:` / `refactor:` 前缀

---

## 九、开放问题

> 待决策的设计问题，开发过程中持续更新。


| #   | 问题                               | 选项                                   | 当前倾向                   |
| --- | -------------------------------- | ------------------------------------ | ---------------------- |
| 1   | 消息历史如何截断以防止超出 context window？    | 滑动窗口 / 摘要压缩 / 手动 pin                 | 滑动窗口（P0 先做最简单的）        |
| 2   | 群聊中 Orchestrator 是否对用户可见？        | 透明展示 / 静默执行                          | 透明展示（有助于理解执行过程）        |
| 3   | 自建 Agent 的 System Prompt 是否支持变量？ | 纯文本 / 支持 {{变量}} 语法                   | 先纯文本，P2 加变量            |
| 4   | 产物文件存储在哪里？                       | `~/.conflux/artifacts` / 数据库 BLOB / 对象存储 | **`~/.conflux/` 本地目录**（与 SQLite 同根） |
| 5   | CLI Agent 的工作目录如何绑定？             | 全局默认 / 按会话绑定 / 按项目绑定                 | 按会话绑定 `workspace_path` |
| 6   | 本机未安装某 Agent 时如何提示？              | 隐藏 / 灰显 + 安装指引 / 仅健康检查报错             | 灰显 + 设置页安装指引           |
| 7   | OrchestratorPlanner 的 LLM 端点？    | 自研 HTTP 客户端 + OpenAI 兼容 API        | **OpenAI 兼容**（`.env` 配置）  |
| 8   | 能否把用户自建 Agent 设为 Orchestrator？   | —                                    | **已决策：永久不允许**（无配置项）   |


