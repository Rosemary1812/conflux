import type { AgentAdapter } from "@/lib/adapters/types";

export type FakeAgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "message_done" };

const chunks = [
  "收到，我会先按当前单聊上下文处理。\n\n",
  "这是 Phase 3 的 fake adapter 流式回复：它已经走过 agent_run、SSE 和消息落库链路。\n\n",
  "下一阶段可以把这里替换成 Claude Code / Codex 的真实适配器，而不需要改前端消息流。"
];

export async function* runFakeAdapter({
  shouldFail,
  signal
}: {
  shouldFail?: boolean;
  signal: AbortSignal;
}): AsyncIterable<FakeAgentEvent> {
  for (const delta of chunks) {
    await delay(420, signal);
    yield { type: "text_delta", delta };
  }

  if (shouldFail) {
    await delay(260, signal);
    throw new Error("Fake adapter error for Phase 3 validation.");
  }

  yield { type: "message_done" };
}

export const fakeAdapter: AgentAdapter = {
  platform: "claude_code",
  async healthcheck() {
    return { ok: true, message: "Fake adapter 可用。" };
  },
  run(params) {
    return runFakeAdapter({
      shouldFail: params.messages.some((message) => shouldTriggerFakeError(message.content)),
      signal: params.signal
    });
  }
};

function shouldTriggerFakeError(content: string) {
  return /(^|\s)\/fake-error(\s|$)|模拟错误|触发错误/i.test(content);
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Run cancelled.", "AbortError"));
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Run cancelled.", "AbortError"));
      },
      { once: true }
    );
  });
}
