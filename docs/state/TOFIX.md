# 待修复池

本文件记录已发现但不一定马上修复的 bug、回归、技术债和体验问题。主线阶段任务请写入根目录 `roadmap.md`。

## 待做

- 时间：2026-05-22 20:21
  优先级：待定
  所属范围：构建
  问题/目标：`npm audit` 报告 Next.js 依赖链中的 `postcss <8.5.10` 存在 moderate 级别安全告警。
  解决方案：等待 Next.js 发布包含安全依赖修复的兼容版本后升级，或评估可控的 package override；不要使用当前 `npm audit fix --force` 给出的破坏性降级方案。
  涉及修改文件：`package.json`、`package-lock.json`
  验收标准：`npm audit --audit-level=moderate` 不再报告该 `postcss` 告警，且 `npm run build`、`npm run typecheck` 通过。

## 已做

- 时间：2026-05-23 12:00
  优先级：P2
  所属范围：UI
  问题/目标：右侧栏与顶栏存在两个功能重复的收起/展开按钮；收起时仍保留约 38px 深色 `context-rail`，右侧竖条始终可见。
  解决方案：仅保留聊天顶栏（Terminal 旁）的右侧栏开关；移除 `ContextPanel` 内收起态 rail 与展开态顶栏的 toggle 按钮；收起时将第三列宽度设为 0 或完全隐藏，使布局呈 L 形（左栏 + 主聊天区），展开时再显示完整上下文面板。
  涉及修改文件：`components/context/ContextPanel.tsx`、`components/chat/MessageStream.tsx`、`components/shell/AppShell.tsx`、`app/globals.css`
  验收标准：全应用仅顶栏一处可切换右侧栏；收起后右侧深色区域完全不可见、不占布局宽度；展开后上下文面板正常显示且可拖拽调整宽度；`npm run typecheck` 通过。
  完成时间：2026-05-23 12:30
  验证结果：`npm run typecheck` 通过；收起时第三列宽度为 0 且不渲染 `ContextPanel`，仅顶栏按钮控制展开/收起。
