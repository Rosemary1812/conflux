"use client";

import { useCallback, useState } from "react";
import { DemoShell } from "@/components/demo/DemoShell";
import type { DemoCaseId } from "@/lib/demo/cases";

export default function DemoPage() {
  const [activeCase, setActiveCase] = useState<DemoCaseId>("single");
  const [caseVersion, setCaseVersion] = useState(0);

  const handleSelectCase = useCallback((id: DemoCaseId) => {
    setActiveCase(id);
    setCaseVersion((version) => version + 1);
  }, []);

  const handleReplay = useCallback(() => {
    setCaseVersion((version) => version + 1);
  }, []);

  return (
    <DemoShell
      activeCase={activeCase}
      caseVersion={caseVersion}
      onReplay={handleReplay}
      onSelectCase={handleSelectCase}
    />
  );
}
