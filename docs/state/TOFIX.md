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

暂无。
