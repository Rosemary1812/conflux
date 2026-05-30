import { NextResponse } from "next/server";
import { listAdapters } from "@/lib/adapters/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const runtimeInfo = await Promise.all(
    listAdapters().map(async (adapter) => {
      const health = await adapter.healthcheck().catch((error) => ({
        ok: false,
        message: String(error),
        capabilities: adapter.capabilities
      }));
      const inspected = await adapter.inspectRuntime?.().catch((error) => ({
        available: false,
        modelName: "unknown" as const,
        source: "unknown" as const,
        message: String(error)
      }));

      return {
        platform: adapter.platform,
        capabilities: health.capabilities ?? adapter.capabilities,
        health: {
          ok: health.ok,
          message: health.message
        },
        runtime: inspected ?? {
          available: health.ok,
          modelName: "unknown",
          source: "unknown",
          message: health.ok
            ? "该 adapter 暂未实现 runtime inspection；Planner 只能按能力与可用性调度。"
            : "adapter 不可用，无法探测 runtime。"
        }
      };
    })
  );

  return NextResponse.json({ runtime: runtimeInfo });
}
