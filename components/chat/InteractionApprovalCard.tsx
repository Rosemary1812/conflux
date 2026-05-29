"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import type { AgentInteraction, ApprovalPayload, InteractionDecision } from "@/lib/interactions/types";

type Props = {
  interaction: AgentInteraction;
  onRespond: (interactionId: string, decision: InteractionDecision) => Promise<void>;
};

export function InteractionApprovalCard({ interaction, onRespond }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const payload = interaction.payload as ApprovalPayload;

  async function respond(approved: boolean) {
    setIsSubmitting(true);
    try {
      await onRespond(interaction.id, { kind: "approval", approved });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="interaction-card approval">
      <div className="interaction-header">
        <span className="interaction-kicker">Approval</span>
        <strong>{payload.summary}</strong>
      </div>
      <dl className="interaction-details">
        <div>
          <dt>动作</dt>
          <dd>{payload.action}</dd>
        </div>
        {payload.path ? (
          <div>
            <dt>路径</dt>
            <dd>{payload.path}</dd>
          </div>
        ) : null}
        {payload.command ? (
          <div>
            <dt>命令</dt>
            <dd>{payload.command}</dd>
          </div>
        ) : null}
        {payload.risk ? (
          <div>
            <dt>风险</dt>
            <dd>{payload.risk}</dd>
          </div>
        ) : null}
      </dl>
      <div className="interaction-actions">
        <button className="secondary-button compact" disabled={isSubmitting} onClick={() => respond(false)} type="button">
          <X size={14} />
          拒绝
        </button>
        <button className="primary-button compact" disabled={isSubmitting} onClick={() => respond(true)} type="button">
          <Check size={14} />
          批准
        </button>
      </div>
    </section>
  );
}
