import type { DemoCase, DemoSetters } from "@/lib/demo/types";
import type { AgentDraft } from "@/lib/skills/agent-creator/types";

export function play(demoCase: DemoCase, setters: DemoSetters): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let currentDraft: AgentDraft | null = null;

  function schedule(at: number, fn: () => void) {
    timers.push(setTimeout(fn, at));
  }

  for (const step of demoCase.steps) {
    switch (step.kind) {
      case "message":
        schedule(step.at, () => setters.pushMessage(step.message));
        break;
      case "typing":
        schedule(step.at, () => setters.pushMessage(step.placeholder));
        schedule(step.resolvedAt, () =>
          setters.patchMessage(step.placeholder.id, { ...step.finalPatch, status: "done" })
        );
        break;
      case "preview-open": {
        const draft = step.draft;
        schedule(step.at, () => {
          currentDraft = draft;
          setters.setAgentCreatorPreview({ draft, status: "preview" });
        });
        break;
      }
      case "preview-status": {
        const status = step.status;
        schedule(step.at, () => {
          if (currentDraft) {
            setters.setAgentCreatorPreview({ draft: currentDraft, status });
          }
        });
        break;
      }
      case "context-update":
        schedule(step.at, () => {
          if (step.roster) setters.setRoster(step.roster);
          if (step.tasks) setters.setTasks(step.tasks);
        });
        break;
      case "available-agents":
        schedule(step.at, () => setters.setAvailableAgents(step.agents));
        break;
    }
  }

  return () => {
    for (const t of timers) clearTimeout(t);
  };
}
