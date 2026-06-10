"use client";

import { RotateCcw } from "lucide-react";
import { DEMO_CASES, DEMO_CASE_LABELS, DEMO_CASE_ORDER, type DemoCaseId } from "@/lib/demo/cases";

type DemoControlBarProps = {
  activeCase: DemoCaseId;
  onSelectCase: (id: DemoCaseId) => void;
  onReplay: () => void;
};

export function DemoControlBar({ activeCase, onSelectCase, onReplay }: DemoControlBarProps) {
  return (
    <div
      style={{
        height: 40,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 16,
        background: "var(--bg-shell)",
        borderBottom: "1px solid var(--border)"
      }}
    >
      <span
        style={{
          color: "var(--text-3)",
          fontSize: 12,
          letterSpacing: 0.4,
          fontWeight: 600
        }}
      >
        Conflux · 演示模式
      </span>
      <div style={{ display: "flex", gap: 4 }}>
        {DEMO_CASE_ORDER.map((id) => {
          const isActive = id === activeCase;
          return (
            <button
              key={id}
              onClick={() => onSelectCase(id)}
              title={DEMO_CASES[id].title}
              type="button"
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                background: isActive ? "var(--primary)" : "transparent",
                color: isActive ? "#fff" : "var(--text-2)",
                border: isActive ? "1px solid var(--primary)" : "1px solid var(--border)"
              }}
            >
              {DEMO_CASE_LABELS[id]}
            </button>
          );
        })}
      </div>
      <button
        onClick={onReplay}
        type="button"
        style={{
          marginLeft: "auto",
          padding: "5px 12px",
          borderRadius: 6,
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          cursor: "pointer",
          background: "transparent",
          color: "var(--text-2)",
          border: "1px solid var(--border)"
        }}
      >
        <RotateCcw size={13} />
        重新播放
      </button>
    </div>
  );
}
