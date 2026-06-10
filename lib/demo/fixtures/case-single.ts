import type { DemoCase } from "@/lib/demo/types";

export const caseSingle: DemoCase = {
  id: "single",
  title: "React 博客 · 代码块复制按钮",
  preview: "Claude Code 正在给 <CodeBlock> 加 CopyButton",
  mode: "single",
  conversation: {
    id: "demo-single",
    mode: "single",
    title: "React 博客 · 代码块复制按钮",
    preview: "Claude Code 正在给 <CodeBlock> 加 CopyButton",
    status: "running",
    avatar: "claude-code",
    workspacePath: "D:\\projects\\my-blog",
    lockedAgent: {
      id: "agent-claude-code",
      slug: "claude-code",
      name: "Claude Code",
      platform: "claude_code",
      description: "本机 Claude Code"
    }
  },
  steps: [
    {
      kind: "message",
      at: 200,
      message: {
        id: "u1",
        author: "你",
        tone: "user",
        time: "14:28",
        body: "帮我给 React 博客里的 `<CodeBlock>` 加一个「复制」按钮:点击复制代码内容,1.5 秒后自动恢复。"
      }
    },
    {
      kind: "typing",
      at: 1000,
      placeholder: {
        id: "a1",
        author: "Claude Code",
        avatar: "claude-code",
        tone: "agent",
        status: "running",
        time: "14:28",
        body: "正在读取 `src/components/CodeBlock.tsx` 确认现有结构…"
      },
      resolvedAt: 3200,
      finalPatch: {
        body: "看到了。`<CodeBlock>` 是函数组件,只渲染 `<pre><code>`。我会新增一个 `<CopyButton>` 子组件:用本地 state 记录复制状态,`onClick` 调 `navigator.clipboard.writeText`,1.5 秒后自动回滚。",
        code: `import { useState } from "react";
import { Clipboard, Check } from "lucide-react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function handleClick() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button aria-label="复制代码" onClick={handleClick}>
      {copied ? <Check size={14} /> : <Clipboard size={14} />}
    </button>
  );
}`,
        artifacts: [
          {
            id: "art-copybtn",
            type: "file",
            title: "CopyButton.tsx",
            description: "新增 CopyButton 组件,负责复制 + 状态回滚",
            path: "src/components/CopyButton.tsx"
          },
          {
            id: "art-codeblock",
            type: "file",
            title: "CodeBlock.tsx",
            description: "在右上角挂载 <CopyButton text={code} />",
            path: "src/components/CodeBlock.tsx"
          }
        ]
      }
    },
    {
      kind: "typing",
      at: 4200,
      placeholder: {
        id: "a2",
        author: "Claude Code",
        avatar: "claude-code",
        tone: "agent",
        status: "running",
        time: "14:29",
        body: "运行 `pnpm lint` 验证改动…"
      },
      resolvedAt: 6800,
      finalPatch: {
        body: "lint 通过,无警告。新增 2 处 import,符合现有风格。"
      }
    },
    {
      kind: "message",
      at: 7800,
      message: {
        id: "a3",
        author: "Claude Code",
        avatar: "claude-code",
        tone: "agent",
        status: "done",
        time: "14:29",
        body: "完成。顺手处理了 2 个边界:\n- 老 Safari 不支持 `navigator.clipboard` → 加了 try/catch 回退到 `document.execCommand(\"copy\")`\n- 1.5s 内组件卸载会触发 React state warning → 用 useRef + cleanup 守住"
      }
    }
  ]
};
