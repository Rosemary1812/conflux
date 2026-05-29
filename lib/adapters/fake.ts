import type { AgentAdapter, AdapterRunParams, AgentEvent } from "@/lib/adapters/types";

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
  capabilities: {
    supportsApproval: "native",
    supportsChoice: "native"
  },
  async healthcheck() {
    return { ok: true, message: "Fake adapter 可用。" };
  },
  run(params) {
    return runFakeAdapterForParams(params);
  }
};

async function* runFakeAdapterForParams(params: AdapterRunParams): AsyncIterable<AgentEvent> {
  const latestUserMessage = [...params.messages].reverse().find((message) => message.role === "user")?.content ?? "";

  if (shouldTriggerApproval(latestUserMessage)) {
    yield { type: "text_delta", delta: "我需要先确认这次写入操作。\n\n" };
    const decision = await params.requestInteraction({
      kind: "approval",
      messageId: "",
      payload: {
        action: "write_file",
        summary: "写入演示文件以验证 V1.5 Approval pause/resume。",
        path: `${params.workspacePath}\\agenthub-v15-approval.txt`,
        risk: "会在当前工作区创建或覆盖一个演示文本文件。"
      }
    });

    if (decision.kind !== "approval" || !decision.approved) {
      yield { type: "message_error", error: "用户拒绝了 Approval，run 已结束。" };
      return;
    }

    yield { type: "text_delta", delta: "已收到批准，继续同一个 run 完成后续输出。\n\n" };
    yield { type: "message_done" };
    return;
  }

  if (shouldTriggerChoice(latestUserMessage)) {
    yield { type: "text_delta", delta: "我需要你选择下一步处理方向。\n\n" };
    const decision = await params.requestInteraction({
      kind: "choice",
      messageId: "",
      payload: {
        prompt: "下一步优先处理哪一类任务？",
        options: [
          { id: "api", label: "补 API 契约", description: "先收口后端接口和 SSE。" },
          { id: "ui", label: "打磨单聊 UI", description: "先完善 inline 交互体验。" },
          { id: "qa", label: "做回归验证", description: "先跑主链路和边界检查。" }
        ],
        allowCustom: true
      }
    });
    const selected = decision.kind === "choice" ? decision.customText || decision.selectedOptionIds[0] || "未选择" : "未选择";

    yield { type: "text_delta", delta: `收到选择：${selected}。我会继续同一个 run 输出结果。\n\n` };
    yield { type: "message_done" };
    return;
  }

  yield* runFakeAdapter({
    shouldFail: params.messages.some((message) => shouldTriggerFakeError(message.content)),
    signal: params.signal
  });
}

function shouldTriggerFakeError(content: string) {
  return /(^|\s)\/fake-error(\s|$)|模拟错误|触发错误/i.test(content);
}

function shouldTriggerApproval(content: string) {
  return /(^|\s)\/fake-approval(\s|$)|审批|批准/i.test(content);
}

function shouldTriggerChoice(content: string) {
  return /(^|\s)\/fake-choice(\s|$)|选项|选择/i.test(content);
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
