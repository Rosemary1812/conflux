import { Bot, LockKeyhole, Network } from "lucide-react";
import type { ConversationView } from "@/lib/conversations/types";

type ConversationSetupProps = {
  view: Extract<ConversationView, "new-single" | "new-group">;
};

export function ConversationSetup({ view }: ConversationSetupProps) {
  const isGroup = view === "new-group";

  return (
    <div className="setup-wrap">
      <div className="setup-card">
        <div className="setup-icon">{isGroup ? <Network size={24} /> : <Bot size={24} />}</div>
        <h2>{isGroup ? "群聊会话" : "单聊会话"}</h2>
        <p>
          {isGroup
            ? "群聊进入后不预选 Agent，首条消息可连续 @ 多个 Agent。V1 只展示群聊结构，不触发真实编排。"
            : "新建聊天直接进入空白会话，首条消息必须且只能 @ 一个 Agent。发送成功后，该 Agent 会锁定为当前单聊对象。"}
        </p>

        <div className="system-note">
          {isGroup ? (
            <>
              <span>第一步：输入多个 Agent mention，例如 @claude-code @codex。</span>
              <span>第二步：界面自动展示 Orchestrator 加入。</span>
              <span>第三步：V1 只进入静态预览，不调用真实 Orchestrator。</span>
            </>
          ) : (
            <>
              <span>第一步：输入一个 Agent mention，例如 @claude-code。</span>
              <span>第二步：发送第一条消息后锁定该 Agent。</span>
              <span>第三步：如果要换 Agent，只能重新新建聊天。</span>
            </>
          )}
        </div>

        <div className="mention-row">
          <span>@claude-code</span>
          {isGroup ? <span>@codex</span> : null}
          <span className="locked">
            <LockKeyhole size={13} />
            {isGroup ? "@orchestrator 自动加入" : "发送后锁定"}
          </span>
        </div>

        <div className="setup-rule">
          示例：
          <code>
            {isGroup
              ? "@claude-code @codex 帮我并行做设置页 UI 和接口校验"
              : "@claude-code 帮我 review 当前分支改动"}
          </code>
        </div>
      </div>
    </div>
  );
}
