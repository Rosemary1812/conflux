// Smoke test for the agent-creator state machine.
// Run with: npx tsx scripts/test-agent-creator-state.ts
import { applyEvent, createSession, getSession, clearSession } from "../lib/skills/agent-creator/state";
import { agentDraftSchema } from "../lib/skills/agent-creator/types";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  } else {
    console.log("OK:", msg);
  }
}

const session = createSession({ conversationId: "test-conv-1", userMessageId: "msg-1" });
assert(session.state === "collecting", "initial state is collecting");

const userInput = applyEvent(session, { type: "USER_INPUT", text: "想做一个代码审查 Agent", messageId: "msg-1" });
assert(userInput.history.length === 1, "user input appended to history");

const llmResp = applyEvent(userInput, {
  type: "LLM_RESPONSE",
  response: {
    intent: "agent_creator",
    info_sufficient: false,
    confidence: 0.6,
    summary: "我需要知道更多细节",
    draft: { name: "Code Reviewer", tool_profile: "readonly", permission_mode: "readonly" },
    next_question: {
      prompt: "这个 Agent 是否需要修改文件？",
      options: [
        { id: "readonly", label: "只读", description: "不修改" },
        { id: "editable", label: "可写", description: "允许修改" }
      ]
    },
    missing_fields: ["system_prompt", "capabilities", "alias", "display_name", "description"],
    warnings: []
  }
});
assert(llmResp.state === "collecting", "still collecting after partial LLM response");
assert(llmResp.draft.name === "Code Reviewer", "draft merged correctly");

const choice = applyEvent(llmResp, {
  type: "CHOICE_RESPONDED",
  interactionId: "i-1",
  selectedOptionIds: ["readonly"],
  customText: undefined
});
assert(choice.state === "collecting", "still collecting after choice");
assert(choice.history[choice.history.length - 1].text === "readonly", "choice appended to history");

const fullLlm = applyEvent(choice, {
  type: "LLM_RESPONSE",
  response: {
    intent: "agent_creator",
    info_sufficient: true,
    confidence: 0.95,
    summary: "信息够了",
    draft: {
      name: "Code Reviewer",
      alias: "code-reviewer",
      display_name: "代码审查助手",
      description: "审查 PR 风险",
      system_prompt: "你是一个代码审查助手，只读不写。",
      permission_mode: "readonly",
      capabilities: ["代码审查", "风险识别"],
      tool_profile: "readonly"
    },
    next_question: undefined,
    missing_fields: [],
    warnings: []
  }
});
assert(fullLlm.state === "confirm_build", "transitions to confirm_build when info_sufficient and complete");

const confirm = applyEvent(fullLlm, {
  type: "CHOICE_RESPONDED",
  interactionId: "i-2",
  selectedOptionIds: ["start"],
  customText: undefined
});
assert(confirm.state === "preview", "transitions to preview after user picks start");

const parsed = agentDraftSchema.safeParse(confirm.draft);
assert(parsed.success, "draft validates against schema");
assert(parsed.success && parsed.data.tool_profile === "readonly", "tool_profile preserved");

const saved = applyEvent(confirm, { type: "USER_CONFIRMED" });
assert(saved.state === "saving", "transitions to saving on USER_CONFIRMED");

// /cancel at any point
const cancelSession = createSession({ conversationId: "test-conv-2", userMessageId: "msg-2" });
const cancelled = applyEvent(cancelSession, { type: "USER_CANCELLED", reason: "user typed /cancel" });
assert(cancelled.state === "cancelled", "/cancel transitions to cancelled");

// executor profile preserved
const executorDraft = applyEvent(createSession({ conversationId: "test-conv-3", userMessageId: "m3" }), {
  type: "LLM_RESPONSE",
  response: {
    intent: "agent_creator",
    info_sufficient: true,
    confidence: 0.9,
    summary: "ok",
    draft: {
      name: "Executor",
      alias: "executor-agent",
      display_name: "执行者",
      description: "d",
      system_prompt: "p",
      permission_mode: "editable",
      capabilities: ["a"],
      tool_profile: "executor"
    },
    missing_fields: [],
    warnings: []
  }
});
assert(executorDraft.requireDangerConfirm === true, "executor profile flagged for danger confirm");

// Lookup by conversationId
// Note: applyEvent returns a new object but does NOT persist; only createSession / clearSession / persistSession mutate the store.
// So getSession after a series of applyEvent calls returns the most recently *persisted* snapshot.
clearSession("test-conv-1");
const fresh = createSession({ conversationId: "test-conv-1", userMessageId: "msg-1" });
assert(getSession("test-conv-1") === fresh, "getSession retrieves the persisted session after createSession");
clearSession("test-conv-1");
assert(getSession("test-conv-1") === null, "clearSession removes session");

console.log("\nAll state machine smoke tests passed.");
