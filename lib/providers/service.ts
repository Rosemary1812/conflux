import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { orchestratorSettings, providers } from "@/lib/db/schema";
import type {
  OrchestratorSettingsSummary,
  ProviderInput,
  ProviderProtocol,
  ProviderSummary
} from "@/lib/providers/types";

const SETTINGS_ID = "default";

type ProviderRow = typeof providers.$inferSelect;

export class ProviderApiError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export function listProviders() {
  return getDb()
    .select()
    .from(providers)
    .orderBy(providers.createdAt)
    .all()
    .map(toSummary);
}

export function getProvider(providerId: string) {
  const provider = getDb().select().from(providers).where(eq(providers.id, providerId)).get();

  if (!provider) {
    throw new ProviderApiError("Provider 不存在。", 404);
  }

  return provider;
}

export function createProvider(input: ProviderInput) {
  const now = Date.now();
  const normalized = normalizeProviderInput(input, { requireSecret: true });
  const provider: ProviderRow = {
    id: randomUUID(),
    name: normalized.name,
    protocol: normalized.protocol,
    baseUrl: normalized.baseUrl,
    apiKeyEncrypted: encodeSecret(normalized.apiKey),
    defaultModel: normalized.defaultModel,
    enabled: normalized.enabled,
    lastCheckStatus: "unchecked",
    lastCheckMessage: null,
    lastCheckedAt: null,
    createdAt: now,
    updatedAt: now
  };

  getDb().insert(providers).values(provider).run();
  return toSummary(provider);
}

export function updateProvider(providerId: string, input: ProviderInput) {
  const current = getProvider(providerId);
  const normalized = normalizeProviderInput(input, {
    current,
    requireSecret: false
  });
  const updated = {
    name: normalized.name,
    protocol: normalized.protocol,
    baseUrl: normalized.baseUrl,
    apiKeyEncrypted:
      normalized.apiKey.length > 0 ? encodeSecret(normalized.apiKey) : current.apiKeyEncrypted,
    defaultModel: normalized.defaultModel,
    enabled: normalized.enabled,
    updatedAt: Date.now()
  };

  getDb().update(providers).set(updated).where(eq(providers.id, providerId)).run();
  return toSummary({ ...current, ...updated });
}

export function deleteProvider(providerId: string) {
  getProvider(providerId);
  getDb()
    .update(orchestratorSettings)
    .set({ plannerProviderId: null, updatedAt: Date.now() })
    .where(eq(orchestratorSettings.plannerProviderId, providerId))
    .run();
  getDb().delete(providers).where(eq(providers.id, providerId)).run();
}

export async function testProvider(providerId: string) {
  const provider = getProvider(providerId);
  const apiKey = decodeSecret(provider.apiKeyEncrypted);
  const result = await callProvider(provider, apiKey);
  const now = Date.now();

  getDb()
    .update(providers)
    .set({
      lastCheckStatus: result.ok ? "ok" : "error",
      lastCheckMessage: result.message,
      lastCheckedAt: now,
      updatedAt: now
    })
    .where(eq(providers.id, providerId))
    .run();

  return {
    ok: result.ok,
    message: result.message,
    provider: toSummary({
      ...provider,
      lastCheckStatus: result.ok ? "ok" : "error",
      lastCheckMessage: result.message,
      lastCheckedAt: now,
      updatedAt: now
    })
  };
}

export function getOrchestratorSettings(): OrchestratorSettingsSummary {
  const db = getDb();
  const settings = db
    .select()
    .from(orchestratorSettings)
    .where(eq(orchestratorSettings.id, SETTINGS_ID))
    .get();

  if (settings) {
    return {
      plannerProviderId: settings.plannerProviderId,
      updatedAt: settings.updatedAt
    };
  }

  const now = Date.now();
  db.insert(orchestratorSettings)
    .values({ id: SETTINGS_ID, plannerProviderId: null, updatedAt: now })
    .run();

  return { plannerProviderId: null, updatedAt: now };
}

export function updateOrchestratorSettings(input: { plannerProviderId?: string | null }) {
  const plannerProviderId = input.plannerProviderId ?? null;
  const now = Date.now();
  getOrchestratorSettings();
  getDb()
    .update(orchestratorSettings)
    .set({ plannerProviderId, updatedAt: now })
    .where(eq(orchestratorSettings.id, SETTINGS_ID))
    .run();

  return { plannerProviderId, updatedAt: now };
}

function normalizeProviderInput(
  input: ProviderInput,
  options: { current?: ProviderRow; requireSecret: boolean }
) {
  const name = normalizeText(input.name ?? options.current?.name, "Provider 名称不能为空。");
  const protocol = normalizeProtocol(input.protocol ?? options.current?.protocol);
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? options.current?.baseUrl);
  const defaultModel = normalizeText(input.defaultModel ?? options.current?.defaultModel, "默认模型不能为空。");
  const enabled = input.enabled ?? options.current?.enabled ?? true;
  const apiKey = input.apiKey?.trim() ?? "";

  if (options.requireSecret && apiKey.length === 0) {
    throw new ProviderApiError("API Key 不能为空。");
  }

  return { name, protocol, baseUrl, apiKey, defaultModel, enabled };
}

function normalizeProtocol(protocol: string | undefined): ProviderProtocol {
  if (protocol === "anthropic" || protocol === "openai_compatible") {
    return protocol;
  }

  throw new ProviderApiError("Provider 协议无效。");
}

function normalizeText(value: string | undefined, error: string) {
  const trimmed = value?.trim() ?? "";

  if (trimmed.length === 0) {
    throw new ProviderApiError(error);
  }

  return trimmed;
}

function normalizeBaseUrl(value: string | undefined) {
  const trimmed = normalizeText(value, "Base URL 不能为空。").replace(/\/+$/, "");

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new ProviderApiError("Base URL 必须是有效的 http(s) URL。");
  }

  return trimmed;
}

function toSummary(provider: ProviderRow): ProviderSummary {
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    maskedKey: maskSecret(decodeSecret(provider.apiKeyEncrypted)),
    defaultModel: provider.defaultModel,
    enabled: provider.enabled,
    lastCheckStatus: provider.lastCheckStatus,
    lastCheckMessage: provider.lastCheckMessage,
    lastCheckedAt: provider.lastCheckedAt,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt
  };
}

function encodeSecret(secret: string) {
  return Buffer.from(secret, "utf8").toString("base64");
}

function decodeSecret(secret: string) {
  return Buffer.from(secret, "base64").toString("utf8");
}

function maskSecret(secret: string) {
  if (secret.length <= 8) {
    return "••••";
  }

  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

export function getEnvPlannerProvider(): ProviderRow | null {
  const baseUrl = process.env.ORCHESTRATOR_BASE_URL?.trim();
  const apiKey = process.env.ORCHESTRATOR_API_KEY?.trim();
  const model = process.env.ORCHESTRATOR_MODEL?.trim();

  if (!baseUrl || !apiKey || !model) {
    return null;
  }

  const protocol: ProviderProtocol =
    process.env.ORCHESTRATOR_PROTOCOL === "anthropic" ? "anthropic" : "openai_compatible";

  return {
    id: "__env__",
    name: "Env Planner",
    protocol,
    baseUrl,
    apiKeyEncrypted: encodeSecret(apiKey),
    defaultModel: model,
    enabled: true,
    lastCheckStatus: "unchecked",
    lastCheckMessage: null,
    lastCheckedAt: null,
    createdAt: 0,
    updatedAt: 0
  };
}

async function callProvider(provider: ProviderRow, apiKey: string) {
  if (provider.protocol === "openai_compatible") {
    return callOpenAiCompatible(provider, apiKey);
  }

  return callAnthropicCompatible(provider, apiKey);
}

async function callOpenAiCompatible(provider: ProviderRow, apiKey: string) {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: provider.defaultModel,
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: 8,
      temperature: 0
    }),
    signal: AbortSignal.timeout(15000)
  }).catch((error) => ({ ok: false, status: 0, text: async () => String(error) }) as Response);

  return summarizeProviderResponse(response);
}

async function callAnthropicCompatible(provider: ProviderRow, apiKey: string) {
  const response = await fetch(`${provider.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: provider.defaultModel,
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: 8
    }),
    signal: AbortSignal.timeout(15000)
  }).catch((error) => ({ ok: false, status: 0, text: async () => String(error) }) as Response);

  return summarizeProviderResponse(response);
}

async function summarizeProviderResponse(response: Response) {
  if (response.ok) {
    return { ok: true, message: "Provider 测试通过。" };
  }

  const text = (await response.text().catch(() => "")).slice(0, 240);
  const status = response.status > 0 ? `HTTP ${response.status}` : "请求失败";
  return { ok: false, message: text ? `${status}: ${text}` : status };
}
