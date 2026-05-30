export type ProviderProtocol = "anthropic" | "openai_compatible";

export type ProviderCheckStatus = "ok" | "error" | "unchecked";

export type ProviderSummary = {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  maskedKey: string;
  defaultModel: string;
  enabled: boolean;
  lastCheckStatus: ProviderCheckStatus;
  lastCheckMessage?: string | null;
  lastCheckedAt?: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ProviderInput = {
  name?: string;
  protocol?: ProviderProtocol;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  enabled?: boolean;
};

export type OrchestratorSettingsSummary = {
  plannerProviderId: string | null;
  updatedAt: number;
};
