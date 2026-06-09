/**
 * V3.7 C1 smoke for self-built SDK adapter Approval bridge.
 *
 * Drives createCustomAgentPermissionHandler directly with a mocked
 * AdapterRunParams so we can assert:
 *   1. requestInteraction is called with kind=approval and a payload
 *      mapped from SDK tool name / input / options.
 *   2. Approved decisions return { behavior: "allow", updatedInput, toolUseID }.
 *   3. Rejected decisions return { behavior: "deny", message, toolUseID }
 *      (not "error"), so the SDK can keep the same run alive.
 *
 * This is intentionally not a full SDK query smoke: the handler is the
 * surface that V3.7 C1 changes, and a real SDK query would also depend
 * on the configured Provider (MiniMax M3) supporting tool_use.
 */

import { createCustomAgentPermissionHandler } from "../lib/adapters/claude-code-sdk";
import type { AdapterRunParams } from "../lib/adapters/types";
import type { AgentSummary } from "../lib/agents/types";

const agent: AgentSummary = {
  id: "smoke-agent",
  slug: "smoke-agent",
  name: "Smoke Agent",
  platform: "claude_code",
  description: "",
  isSystem: false,
  systemPrompt: "",
  permissionMode: "editable",
  toolProfile: "code-author"
};

type CapturedRequest = {
  interaction: { kind: string; messageId: string; payload: Record<string, unknown> };
  resolve: (decision: { kind: "approval"; approved: boolean }) => void;
};

function buildParams(opts: {
  approve: boolean;
}): { params: AdapterRunParams; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];

  const params: AdapterRunParams = {
    runId: "smoke-run",
    conversationId: "smoke-conv",
    agent,
    workspacePath: process.cwd(),
    messages: [],
    attachments: [],
    signal: new AbortController().signal,
    requestInteraction(interaction) {
      const decision = {
        kind: "approval" as const,
        approved: opts.approve
      };
      captured.push({
        interaction: interaction as CapturedRequest["interaction"],
        resolve: () => decision
      });
      return Promise.resolve(decision);
    },
    saveExternalSessionId: () => {}
  };

  return { params, captured };
}

type CanUseTool = Parameters<ReturnType<typeof createCustomAgentPermissionHandler>>[2] extends infer O
  ? O extends { toolUseID: string }
    ? (toolName: string, input: Record<string, unknown>, options: O) => Promise<unknown>
    : never
  : never;

async function invoke(
  params: AdapterRunParams,
  toolName: string,
  input: Record<string, unknown>,
  options: { toolUseID: string; title?: string; displayName?: string; description?: string; decisionReason?: string; blockedPath?: string; signal: AbortSignal }
) {
  const handler = createCustomAgentPermissionHandler(params);
  return handler(toolName, input, options);
}

function expect(condition: unknown, label: string) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`OK:   ${label}`);
  }
}

async function main() {
  // Case A: Write tool, user approves
  {
    const { params, captured } = buildParams({ approve: true });
    const signal = new AbortController().signal;
    const result = (await invoke(params, "Write", { file_path: "tmp/v37-c1.txt", content: "hi" }, {
      toolUseID: "tool-A",
      title: "Write tmp/v37-c1.txt",
      description: "Will overwrite the file if it exists.",
      signal
    })) as { behavior: string; updatedInput: Record<string, unknown>; toolUseID?: string };

    expect(captured.length === 1, "A: requestInteraction called once");
    expect(captured[0].interaction.kind === "approval", "A: kind=approval");
    expect(captured[0].interaction.payload.action === "write_file", "A: action=write_file");
    expect(captured[0].interaction.payload.path === "tmp/v37-c1.txt", "A: path mapped from file_path");
    expect(captured[0].interaction.payload.summary === "Write tmp/v37-c1.txt", "A: summary from title");
    expect(result.behavior === "allow", "A: behavior=allow");
    expect(result.updatedInput && result.updatedInput.file_path === "tmp/v37-c1.txt", "A: updatedInput preserves input");
    expect(result.toolUseID === "tool-A", "A: toolUseID round-tripped");
  }

  // Case B: Bash tool, command extracted from input.command
  {
    const { params, captured } = buildParams({ approve: true });
    const signal = new AbortController().signal;
    const result = (await invoke(params, "Bash", { command: "npm test" }, {
      toolUseID: "tool-B",
      title: "Run npm test",
      signal
    })) as { behavior: string; toolUseID?: string };

    expect(captured.length === 1, "B: requestInteraction called once");
    expect(captured[0].interaction.payload.action === "run_command", "B: action=run_command");
    expect(captured[0].interaction.payload.command === "npm test", "B: command from input.command");
    expect(result.behavior === "allow", "B: behavior=allow");
  }

  // Case C: Bash tool, command fallback to input.cmd
  {
    const { params, captured } = buildParams({ approve: true });
    const signal = new AbortController().signal;
    await invoke(params, "Bash", { cmd: "ls" }, { toolUseID: "tool-C", signal });
    expect(captured[0].interaction.payload.command === "ls", "C: command fallback to input.cmd");
  }

  // Case D: WebFetch → action=network
  {
    const { params, captured } = buildParams({ approve: true });
    const signal = new AbortController().signal;
    await invoke(params, "WebFetch", { url: "https://example.com" }, { toolUseID: "tool-D", signal });
    expect(captured[0].interaction.payload.action === "network", "D: action=network");
  }

  // Case E: Unknown tool → action=tool_use
  {
    const { params, captured } = buildParams({ approve: true });
    const signal = new AbortController().signal;
    await invoke(params, "WeirdTool", { foo: "bar" }, { toolUseID: "tool-E", signal });
    expect(captured[0].interaction.payload.action === "tool_use", "E: action=tool_use fallback");
  }

  // Case F: Rejected → deny with toolUseID, not "error"
  {
    const { params, captured } = buildParams({ approve: false });
    const signal = new AbortController().signal;
    const result = (await invoke(params, "Write", { file_path: "no.txt" }, {
      toolUseID: "tool-F",
      signal
    })) as { behavior: string; message: string; toolUseID?: string };

    expect(captured[0].interaction.payload.action === "write_file", "F: approval kind still set on reject");
    expect(result.behavior === "deny", "F: behavior=deny");
    expect(typeof result.message === "string" && result.message.length > 0, "F: deny.message present");
    expect(result.toolUseID === "tool-F", "F: deny.toolUseID round-tripped");
  }

  // Case G: blockedPath used as path fallback for Write
  {
    const { params, captured } = buildParams({ approve: true });
    const signal = new AbortController().signal;
    await invoke(params, "Write", { content: "x" }, {
      toolUseID: "tool-G",
      blockedPath: "outside/cwd.txt",
      signal
    });
    expect(captured[0].interaction.payload.path === "outside/cwd.txt", "G: path fallback to blockedPath");
  }

  // Case H: risk filled from description / decisionReason
  {
    const { params, captured } = buildParams({ approve: true });
    const signal = new AbortController().signal;
    await invoke(params, "Bash", { command: "rm -rf /" }, {
      toolUseID: "tool-H",
      description: "Destructive filesystem operation outside the workspace.",
      signal
    });
    const risk = captured[0].interaction.payload.risk as string;
    expect(risk.includes("Destructive"), "H: risk populated from description");
  }

  console.log("---");
  console.log(process.exitCode ? "smoke FAILED" : "smoke OK");
}

main().catch((error) => {
  console.error("smoke threw:", error);
  process.exit(1);
});
