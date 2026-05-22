export type ProviderProtocol = "openai-compatible" | "anthropic-compatible";

export type ProviderStatus = "ok" | "error" | "unchecked";

export type MockProvider = {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  maskedKey: string;
  defaultModel: string;
  status: ProviderStatus;
  lastCheckedAt: string;
  enabled: boolean;
};

export const mockProviders: MockProvider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    maskedKey: "sk-••••••k92d",
    defaultModel: "deepseek-chat",
    status: "ok",
    lastCheckedAt: "今天 20:12",
    enabled: true
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    maskedKey: "sk-or-••••••7qae",
    defaultModel: "anthropic/claude-3.5-sonnet",
    status: "unchecked",
    lastCheckedAt: "未检测",
    enabled: true
  },
  {
    id: "anthropic-direct",
    name: "Anthropic Direct",
    protocol: "anthropic-compatible",
    baseUrl: "https://api.anthropic.com",
    maskedKey: "sk-ant-••••••m4c1",
    defaultModel: "claude-3-5-sonnet-latest",
    status: "error",
    lastCheckedAt: "昨天 23:40",
    enabled: false
  }
];
