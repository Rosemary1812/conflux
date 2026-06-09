/**
 * V3.7 C3 group / Orchestrator end-to-end smoke.
 *
 * Drives the real HTTP API:
 *   1. POST /api/conversations  (group mode)
 *   2. POST /api/messages       (mentions both the C3 self-built code-author
 *                               agent and v34-real-smoke; asks for a file
 *                               write so the SDK canUseTool path should fire)
 *   3. GET  /api/conversations/:id/stream  (SSE)
 *   4. Wait for interaction_requested, POST respond approved
 *   5. Wait for run to settle (message_status= done / cancelled / error)
 *
 * The smoke times out around the SDK query itself; if minimax M3 does
 * not emit a tool_use block, no Approval card will appear and the
 * smoke reports "no approval observed" — that outcome is itself
 * informative and is reported verbatim rather than masked.
 */

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3942";
const TIMEOUT_MS = 90_000;

function expect(condition, label) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`OK:   ${label}`);
  }
}

async function postJson(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
}

async function main() {
  console.log(`--- V3.7 C3 E2E smoke (base=${BASE}) ---`);

  // 1. Create group conversation
  const created = await postJson("/api/conversations", { mode: "group" });
  if (created.status !== 201) {
    console.error("create conversation failed", created);
    process.exit(1);
  }
  const conversationId = created.body.conversation.id;
  expect(typeof conversationId === "string" && conversationId.length > 0, "conversation created");

  // 2. Open SSE stream first so we don't miss the interaction
  const events = [];
  const controller = new AbortController();
  const streamPromise = (async () => {
    const response = await fetch(`${BASE}/api/conversations/${conversationId}/stream`, {
      signal: controller.signal
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          const eventName = line.slice(7).trim();
          // data line follows
          continue;
        }
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            events.push({ type: data.type ?? "unknown", payload: data });
          } catch {
            // ignore non-JSON
          }
        }
      }
    }
  })();

  // give SSE a moment to subscribe
  await new Promise((r) => setTimeout(r, 800));

  // 3. Send message mentioning both agents
  const sent = await postJson("/api/messages", {
    conversationId,
    content: "@v37-c3-code-author @v34-real-smoke 请把 tmp/v37-c3-hello.txt 写入一行 'hello v3.7 C3'。由 code-author 实际写文件，另一个 agent 保持只读检查。"
  });
  console.log("---sendMessage response---");
  console.log("status:", sent.status);
  console.log("body:", JSON.stringify(sent.body, null, 2).slice(0, 1500));
  if (sent.status !== 201) {
    console.error("send message failed");
    controller.abort();
    process.exit(1);
  }
  console.log("OK:   message sent (status 201)");

  // 4. Wait for an interaction_requested (approval) or terminal event
  const deadline = Date.now() + TIMEOUT_MS;
  let interaction = null;
  while (Date.now() < deadline) {
    if (events.length > 0) {
      const last = events[events.length - 1];
      if (last.type === "interaction_requested" && !interaction) {
        interaction = last.payload.interaction;
        break;
      }
      const terminal = events.find(
        (e) => e.type === "message_status" && ["done", "error", "cancelled"].includes(e.payload.status)
      );
      if (terminal) {
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Print every event for forensic context
  console.log(`--- SSE event summary (${events.length}) ---`);
  for (const event of events) {
    const summary =
      event.type === "interaction_requested"
        ? `kind=${event.payload.interaction?.kind} status=${event.payload.interaction?.status}`
        : event.type === "run_status" || event.type === "message_status" || event.type === "task_status"
        ? `status=${event.payload.status}`
        : event.type === "message_delta"
        ? `delta(len)=${(event.payload.delta ?? "").length}`
        : event.type;
    console.log(`  ${event.type}  ${summary}`);
  }

  if (!interaction) {
    console.log("---");
    console.log("INFO: no interaction_requested observed within timeout.");
    console.log("Either minimax M3 did not emit a tool_use block, or the SDK adapter did not run.");
    console.log("C3 端到端 Approval 卡片未出现，TOFIX 记录 M3 tool_use 兼容性。");
    controller.abort();
    await streamPromise.catch(() => {});
    process.exit(2);
  }

  expect(interaction.kind === "approval", "C3: interaction kind is approval");

  // 5. POST respond
  const responded = await postJson(`/api/interactions/${interaction.id}/respond`, {
    kind: "approval",
    approved: true
  });
  expect(responded.status === 200, "C3: respond returned 200");
  expect(responded.body?.interaction?.status === "approved", "C3: interaction marked approved");

  // 6. Wait for run to settle
  const runDeadline = Date.now() + 60_000;
  let settled = false;
  while (Date.now() < runDeadline) {
    const terminal = events.find(
      (e) =>
        (e.type === "message_status" || e.type === "run_status") &&
        ["done", "error", "cancelled"].includes(e.payload.status)
    );
    if (terminal) {
      settled = true;
      console.log(`OK:   run settled with ${terminal.type}=${terminal.payload.status}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!settled) {
    console.log("INFO: run did not settle within 60s of approval");
    process.exitCode = 1;
  }

  controller.abort();
  await streamPromise.catch(() => {});
  console.log("---");
  console.log(process.exitCode ? "smoke FAILED" : "smoke OK");
}

main().catch((error) => {
  console.error("smoke threw:", error);
  process.exit(1);
});
