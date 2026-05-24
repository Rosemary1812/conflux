import type { AgentAdapter, AdapterRunParams } from "@/lib/adapters/types";
import { commandExists } from "@/lib/adapters/process-runner";

export function unavailableCliAdapter(platform: string, command: string): AgentAdapter {
  return {
    platform,
    async healthcheck() {
      const ok = await commandExists(command);

      return {
        ok,
        message: ok ? `${command} CLI 已安装。` : `未在 PATH 中找到 ${command} CLI。`
      };
    },
    async *run(_: AdapterRunParams) {
      const health = await this.healthcheck();

      if (!health.ok) {
        yield { type: "message_error", error: health.message };
        return;
      }

      yield {
        type: "message_error",
        error: `${command} CLI 已安装，但该平台的结构化运行适配器尚未接入。`
      };
    }
  };
}
