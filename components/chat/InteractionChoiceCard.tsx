"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import type { AgentInteraction, ChoicePayload, InteractionDecision } from "@/lib/interactions/types";

type Props = {
  interaction: AgentInteraction;
  onRespond: (interactionId: string, decision: InteractionDecision) => Promise<void>;
};

export function InteractionChoiceCard({ interaction, onRespond }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const payload = interaction.payload as ChoicePayload;

  async function choose(optionId: string, custom?: string) {
    setIsSubmitting(true);
    try {
      await onRespond(interaction.id, {
        kind: "choice",
        selectedOptionIds: optionId ? [optionId] : [],
        customText: custom?.trim() || undefined
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="interaction-card choice">
      <div className="interaction-header">
        <span className="interaction-kicker">Choice</span>
        <strong>{payload.prompt}</strong>
      </div>
      <div className="choice-options">
        {payload.options.map((option, index) => (
          <button
            className="choice-option"
            disabled={isSubmitting}
            key={option.id}
            onClick={() => choose(option.id)}
            type="button"
          >
            <span>{String.fromCharCode(65 + index)}</span>
            <strong>{option.label}</strong>
            {option.description ? <small>{option.description}</small> : null}
          </button>
        ))}
      </div>
      {payload.allowCustom ? (
        <div className="choice-custom">
          {customOpen ? (
            <>
              <textarea
                disabled={isSubmitting}
                onChange={(event) => setCustomText(event.target.value)}
                placeholder="输入其他选择"
                rows={3}
                value={customText}
              />
              <button
                className="primary-button compact"
                disabled={isSubmitting || !customText.trim()}
                onClick={() => choose("", customText)}
                type="button"
              >
                <Send size={14} />
                提交选择
              </button>
            </>
          ) : (
            <button className="message-action-button" disabled={isSubmitting} onClick={() => setCustomOpen(true)} type="button">
              其他
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
