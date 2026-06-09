"use client";

import {
  Bot,
  CheckCircle2,
  KeyRound,
  Languages,
  Moon,
  Pencil,
  PlugZap,
  Plus,
  Settings2,
  Shield,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AgentFormDraft, AgentFormErrors } from "@/components/settings/custom-agents/AgentEditPanel";
import { AgentDeleteConfirm } from "@/components/settings/custom-agents/AgentDeleteConfirm";
import { AgentDetailPanel } from "@/components/settings/custom-agents/AgentDetailPanel";
import { AgentEditPanel } from "@/components/settings/custom-agents/AgentEditPanel";
import { AgentListPanel } from "@/components/settings/custom-agents/AgentListPanel";
import type { AgentAvatarKind, AgentSummary, SelfBuiltAgentListItem } from "@/lib/agents/types";
import type { AgentDeletePrecheck } from "@/lib/conversations/service";

type SettingsModalProps = {
  onClose: () => void;
  open: boolean;
};

type ProviderProtocol = "anthropic" | "openai_compatible";
type ProviderStatus = "ok" | "error" | "unchecked";

type ProviderSummary = {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  maskedKey: string;
  defaultModel: string;
  enabled: boolean;
  lastCheckStatus: ProviderStatus;
  lastCheckMessage?: string | null;
  lastCheckedAt?: number | null;
};

type ProviderDraft = {
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  enabled: boolean;
};

const tabs = [
  { id: "appearance", label: "外观与语言", icon: Languages },
  { id: "agents", label: "本机 Agent 连接", icon: PlugZap },
  { id: "orchestrator", label: "Orchestrator", icon: Shield },
  { id: "providers", label: "Provider 与密钥", icon: KeyRound },
  { id: "skills", label: "Skill 管理", icon: Settings2 },
  { id: "custom", label: "自建 Agent", icon: Bot }
] as const;

type TabId = (typeof tabs)[number]["id"];

export function SettingsModal({ onClose, open }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("appearance");
  const [darkMode, setDarkMode] = useState(false);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>设置</h2>
            <p>从左下角设置按钮弹出，不作为独立业务路由。</p>
          </div>
          <button aria-label="关闭设置" className="icon-button" onClick={onClose} type="button">
            <X size={17} />
          </button>
        </header>

        <div className="settings-shell">
          <nav className="settings-nav" aria-label="设置分类">
            {tabs.map((tab) => {
              const Icon = tab.icon;

              return (
                <button
                  className={activeTab === tab.id ? "active" : ""}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
          <div className="settings-main">
            {activeTab === "appearance" ? (
              <section>
                <h3>外观与语言</h3>
                <p className="desc">保留用户直接可理解的界面设置。</p>
                <div className="settings-card">
                  <div className="setting-row">
                    <div>
                      <strong>深色模式</strong>
                      <p>Phase 1 只做本地交互态。</p>
                    </div>
                    <button
                      aria-pressed={darkMode}
                      className={darkMode ? "toggle on" : "toggle"}
                      onClick={() => setDarkMode((value) => !value)}
                      type="button"
                    >
                      <Moon size={13} />
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>界面语言</strong>
                      <p>支持中文 / English 的占位选择。</p>
                    </div>
                    <select>
                      <option>简体中文</option>
                      <option>English</option>
                    </select>
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === "agents" ? <AgentsPanel /> : null}
            {activeTab === "orchestrator" ? <OrchestratorPanel /> : null}
            {activeTab === "providers" ? <ProvidersPanel /> : null}
            {activeTab === "skills" ? <SkillsPanel /> : null}
            {activeTab === "custom" ? <CustomAgentsPanel /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentsPanel() {
  const [health, setHealth] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [runtimeInfo, setRuntimeInfo] = useState<
    Record<string, { modelName: string; source: string; message: string }>
  >({});
  const [checking, setChecking] = useState(false);

  async function refreshHealth() {
    setChecking(true);

    try {
      const [healthResponse, runtimeResponse] = await Promise.all([
        fetch("/api/agents/health"),
        fetch("/api/agents/runtime")
      ]);
      const healthPayload = (await healthResponse.json()) as {
        health?: Array<{ platform: string; ok: boolean; message: string }>;
      };
      const runtimePayload = (await runtimeResponse.json()) as {
        runtime?: Array<{
          platform: string;
          runtime: { modelName: string; source: string; message: string };
        }>;
      };

      setHealth(
        Object.fromEntries(
          (healthPayload.health ?? []).map((item) => [item.platform, { ok: item.ok, message: item.message }])
        )
      );
      setRuntimeInfo(
        Object.fromEntries(
          (runtimePayload.runtime ?? []).map((item) => [
            item.platform,
            {
              modelName: item.runtime.modelName,
              source: item.runtime.source,
              message: item.runtime.message
            }
          ])
        )
      );
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void refreshHealth();
  }, []);

  return (
    <section>
      <h3>本机 Agent 连接</h3>
      <p className="desc">Phase 4 通过本机 CLI healthcheck 展示真实连接状态。</p>
      <div className="settings-card">
        <button className="primary-button" disabled={checking} onClick={refreshHealth} type="button">
          {checking ? "检测中..." : "重新检测全部"}
        </button>
        <HealthRow detail={health.claude_code?.message ?? "等待检测"} name="Claude Code" ok={health.claude_code?.ok} />
        <RuntimeLine info={runtimeInfo.claude_code} />
        <HealthRow detail={health.codex?.message ?? "等待检测"} name="Codex" ok={health.codex?.ok} />
        <RuntimeLine info={runtimeInfo.codex} />
        <HealthRow detail={health.hermes?.message ?? "等待检测"} name="Hermes" ok={health.hermes?.ok} />
        <RuntimeLine info={runtimeInfo.hermes} />
        <HealthRow detail={health.opencode?.message ?? "等待检测"} name="OpenCode" ok={health.opencode?.ok} />
        <RuntimeLine info={runtimeInfo.opencode} />
      </div>
    </section>
  );
}

function OrchestratorPanel() {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [plannerProviderId, setPlannerProviderId] = useState("");
  const [status, setStatus] = useState("加载中...");

  async function loadSettings() {
    const [providersResponse, settingsResponse] = await Promise.all([
      fetch("/api/providers"),
      fetch("/api/orchestrator/settings")
    ]);
    const providersPayload = (await providersResponse.json()) as { providers?: ProviderSummary[] };
    const settingsPayload = (await settingsResponse.json()) as {
      settings?: { plannerProviderId: string | null };
    };
    setProviders(providersPayload.providers ?? []);
    setPlannerProviderId(settingsPayload.settings?.plannerProviderId ?? "");
    setStatus("");
  }

  async function saveSettings() {
    setStatus("保存中...");
    const response = await fetch("/api/orchestrator/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plannerProviderId: plannerProviderId || null })
    });
    const payload = (await response.json()) as { error?: string };
    setStatus(response.ok ? "已保存。" : payload.error ?? "保存失败。");
  }

  useEffect(() => {
    void loadSettings().catch((error) => setStatus(String(error)));
  }, []);

  const plannerProviders = providers.filter((provider) => provider.enabled);

  return (
    <section>
      <h3>Orchestrator</h3>
      <p className="desc">V2.1 起，Planner 从已保存的 OpenAI Compatible Provider 中选择模型服务。</p>
      <div className="settings-card">
        <label className="field-label">默认 Provider</label>
        <select value={plannerProviderId} onChange={(event) => setPlannerProviderId(event.target.value)}>
          <option value="">未选择</option>
          {plannerProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name} · {provider.defaultModel}
            </option>
          ))}
        </select>
        <p className="desc tight">
          Provider 的 API Key、Base URL 和协议在“Provider 与密钥”中维护；已启用的 Provider 均可作为 Planner 候选。
        </p>
        <div className="inline-actions end">
          <span className="desc tight">{status}</span>
          <button className="primary-button" onClick={saveSettings} type="button">
            保存设置
          </button>
        </div>
      </div>
    </section>
  );
}

function ProvidersPanel() {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [draft, setDraft] = useState<ProviderDraft>(emptyProviderDraft());
  const [editingNew, setEditingNew] = useState(true);
  const [status, setStatus] = useState("加载中...");

  async function loadProviders(preferredId?: string) {
    const response = await fetch("/api/providers");
    const payload = (await response.json()) as { providers?: ProviderSummary[] };
    const nextProviders = payload.providers ?? [];
    const nextSelectedId = preferredId ?? selectedProviderId ?? nextProviders[0]?.id ?? "";
    const selected =
      nextProviders.find((provider) => provider.id === nextSelectedId) ?? nextProviders[0] ?? null;

    setProviders(nextProviders);
    if (selected) {
      setSelectedProviderId(selected.id);
      setDraft(providerToDraft(selected));
      setEditingNew(false);
    } else {
      setSelectedProviderId("");
      setDraft(emptyProviderDraft());
      setEditingNew(true);
    }
    setStatus("");
  }

  useEffect(() => {
    void loadProviders().catch((error) => setStatus(String(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectProvider(provider: ProviderSummary) {
    setSelectedProviderId(provider.id);
    setDraft(providerToDraft(provider));
    setEditingNew(false);
    setStatus("");
  }

  function startNewProvider() {
    setSelectedProviderId("");
    setDraft(emptyProviderDraft());
    setEditingNew(true);
    setStatus("");
  }

  async function saveProvider() {
    setStatus("保存中...");
    const response = await fetch(editingNew ? "/api/providers" : `/api/providers/${selectedProviderId}`, {
      method: editingNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft)
    });
    const payload = (await response.json()) as { provider?: ProviderSummary; error?: string };

    if (!response.ok || !payload.provider) {
      setStatus(payload.error ?? "保存失败。");
      return;
    }

    await loadProviders(payload.provider.id);
    setStatus("已保存。");
  }

  async function deleteSelectedProvider() {
    if (editingNew || !selectedProviderId) {
      startNewProvider();
      return;
    }

    setStatus("删除中...");
    const response = await fetch(`/api/providers/${selectedProviderId}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setStatus(payload.error ?? "删除失败。");
      return;
    }

    await loadProviders("");
    setStatus("已删除。");
  }

  async function testSelectedProvider() {
    if (editingNew || !selectedProviderId) {
      setStatus("请先保存 Provider，再测试连接。");
      return;
    }

    setStatus("测试中...");
    const response = await fetch(`/api/providers/${selectedProviderId}/test`, { method: "POST" });
    const payload = (await response.json()) as { message?: string; provider?: ProviderSummary; error?: string };
    await loadProviders(payload.provider?.id ?? selectedProviderId);
    setStatus(payload.message ?? payload.error ?? (response.ok ? "测试完成。" : "测试失败。"));
  }

  return (
    <section>
      <h3>Provider 与密钥</h3>
      <p className="desc">
        Provider 只保存可调用模型服务的信息。Orchestrator 或自建 Agent 使用哪个 Provider，会在各自创建/配置时选择。
      </p>
      <div className="provider-layout">
        <div className="provider-list-panel">
          <div className="provider-panel-head">
            <strong>已保存 Provider</strong>
            <button className="primary-button compact" onClick={startNewProvider} type="button">
              <Plus size={14} />
              新增
            </button>
          </div>
          <div className="provider-list">
            {providers.length === 0 ? <p className="desc tight">还没有保存的 Provider。</p> : null}
            {providers.map((provider) => (
              <button
                className={
                  selectedProviderId === provider.id && !editingNew ? "provider-row active" : "provider-row"
                }
                key={provider.id}
                onClick={() => selectProvider(provider)}
                type="button"
              >
                <span>
                  <strong>{provider.name}</strong>
                  <small>{formatProtocol(provider.protocol)}</small>
                </span>
                <span className={`provider-status ${provider.lastCheckStatus}`}>
                  {formatStatus(provider.lastCheckStatus)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="provider-detail-panel">
          <div className="provider-detail-head">
            <div>
              <h4>{editingNew ? "新增 Provider" : draft.name}</h4>
              <p>
                {draft.enabled ? "已启用" : "已停用"} ·{" "}
                {editingNew ? "未保存" : formatCheckedAt(providers.find((item) => item.id === selectedProviderId))}
              </p>
            </div>
            <div className="inline-actions">
              <button aria-label="编辑 Provider" className="secondary-icon-button" onClick={startNewProvider} type="button">
                <Pencil size={15} />
              </button>
              <button
                aria-label="删除 Provider"
                className="secondary-icon-button danger"
                onClick={deleteSelectedProvider}
                type="button"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          <div className="settings-card form-stack provider-form">
            <label>
              名称
              <input
                value={draft.name}
                onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
              />
            </label>
            <label>
              API 协议
              <select
                value={draft.protocol}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, protocol: event.target.value as ProviderProtocol }))
                }
              >
                <option value="openai_compatible">OpenAI Compatible</option>
                <option value="anthropic">Anthropic Compatible</option>
              </select>
            </label>
            <label>
              Base URL
              <input
                value={draft.baseUrl}
                onChange={(event) => setDraft((value) => ({ ...value, baseUrl: event.target.value }))}
              />
            </label>
            <label>
              API Key
              <input
                placeholder={editingNew ? "sk-..." : "留空表示不修改"}
                value={draft.apiKey}
                onChange={(event) => setDraft((value) => ({ ...value, apiKey: event.target.value }))}
                type="password"
              />
            </label>
            <label>
              默认模型
              <input
                value={draft.defaultModel}
                onChange={(event) => setDraft((value) => ({ ...value, defaultModel: event.target.value }))}
              />
            </label>
            <div className="setting-row no-border">
              <div>
                <strong>启用 Provider</strong>
                <p>停用后不会出现在 Orchestrator 或自建 Agent 的选择列表中。</p>
              </div>
              <button
                aria-pressed={draft.enabled}
                className={draft.enabled ? "toggle on" : "toggle"}
                onClick={() => setDraft((value) => ({ ...value, enabled: !value.enabled }))}
                type="button"
              />
            </div>
            <p className="desc tight">{status}</p>
            <div className="inline-actions end">
              <button className="secondary-button" onClick={testSelectedProvider} type="button">测试连接</button>
              <button className="primary-button" onClick={saveProvider} type="button">保存 Provider</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SkillsPanel() {
  return (
    <section>
      <h3>Skill 管理</h3>
      <p className="desc">V1 不实现 Skill 执行，这里只展示设置入口形态。</p>
      <div className="settings-card">
        <table className="settings-table">
          <thead>
            <tr>
              <th>Slug</th>
              <th>说明</th>
              <th>阶段</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>/agent-creator</td>
              <td>创建 Agent</td>
              <td>V3</td>
            </tr>
            <tr>
              <td>/skill-creator</td>
              <td>创建 Skill</td>
              <td>V3</td>
            </tr>
            <tr>
              <td>/pr-review</td>
              <td>PR 审查</td>
              <td>自建</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

type CustomAgentMode =
  | { kind: "list" }
  | { kind: "detail"; agentId: string; precheck: AgentDeletePrecheck | null }
  | { kind: "edit"; agentId: string };

function emptyDraft(): AgentFormDraft {
  return {
    name: "",
    alias: "",
    description: "",
    systemPrompt: "",
    permissionMode: "readonly",
    toolProfile: "readonly",
    capabilities: [],
    avatarKind: "emoji",
    avatarValue: "🤖"
  };
}

function agentToDraft(agent: AgentSummary): AgentFormDraft {
  const avatarKind: AgentAvatarKind = agent.avatarKind ?? "system";
  return {
    name: agent.name,
    alias: agent.slug,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    permissionMode: agent.permissionMode,
    toolProfile: agent.toolProfile ?? "readonly",
    capabilities: agent.capabilities ?? [],
    avatarKind: avatarKind === "uploaded" ? "uploaded" : "emoji",
    avatarValue: avatarKind === "uploaded" ? (agent.avatarValue ?? "") : agent.avatarValue || "🤖"
  };
}

function CustomAgentsPanel() {
  const [mode, setMode] = useState<CustomAgentMode>({ kind: "list" });
  const [agents, setAgents] = useState<SelfBuiltAgentListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentAgent, setCurrentAgent] = useState<AgentSummary | null>(null);
  const [draft, setDraft] = useState<AgentFormDraft>(emptyDraft());
  const [fieldErrors, setFieldErrors] = useState<AgentFormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{
    precheck: AgentDeletePrecheck;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadList = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/agents/self-built");
      const payload = (await response.json()) as { agents?: SelfBuiltAgentListItem[]; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "加载 Agent 列表失败。");
        setAgents([]);
        return;
      }
      setAgents(payload.agents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载 Agent 列表失败。");
      setAgents([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function openDetail(agentId: string) {
    setStatus("");
    setError(null);
    setDeleteConfirm(null);
    try {
      const response = await fetch(`/api/agents/${agentId}`);
      const payload = (await response.json()) as { agent?: AgentSummary; error?: string };
      if (!response.ok || !payload.agent) {
        setStatus(payload.error ?? "加载 Agent 详情失败。");
        return;
      }
      setCurrentAgent(payload.agent);
      setMode({ kind: "detail", agentId, precheck: null });
      void loadPrecheck(agentId);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "加载 Agent 详情失败。");
    }
  }

  async function loadPrecheck(agentId: string) {
    try {
      const response = await fetch(`/api/agents/${agentId}/precheck-delete`);
      const payload = (await response.json()) as { precheck?: AgentDeletePrecheck; error?: string };
      if (!response.ok || !payload.precheck) {
        return;
      }
      setMode((current) =>
        current.kind === "detail" && current.agentId === agentId
          ? { ...current, precheck: payload.precheck ?? null }
          : current
      );
    } catch {
      // 预检失败不阻塞 UI（删除按钮仍可点，DELETE 阶段会再校一次）
    }
  }

  async function openEditFromList(agentId: string) {
    setStatus("");
    setError(null);
    try {
      const response = await fetch(`/api/agents/${agentId}`);
      const payload = (await response.json()) as { agent?: AgentSummary; error?: string };
      if (!response.ok || !payload.agent) {
        setStatus(payload.error ?? "加载 Agent 失败。");
        return;
      }
      setCurrentAgent(payload.agent);
      setDraft(agentToDraft(payload.agent));
      setFieldErrors({});
      setMode({ kind: "edit", agentId: payload.agent.id });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "加载 Agent 失败。");
    }
  }

  function openEdit() {
    if (!currentAgent) return;
    setDraft(agentToDraft(currentAgent));
    setFieldErrors({});
    setStatus("");
    setMode({ kind: "edit", agentId: currentAgent.id });
  }

  function cancelEdit() {
    if (!currentAgent) {
      setMode({ kind: "list" });
      return;
    }
    setDraft(agentToDraft(currentAgent));
    setFieldErrors({});
    setStatus("");
    setMode({ kind: "detail", agentId: currentAgent.id, precheck: null });
  }

  async function saveEdit() {
    if (!currentAgent) return;
    setIsSaving(true);
    setFieldErrors({});
    setStatus("保存中...");
    const errors = validateDraft(draft);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setStatus("");
      setIsSaving(false);
      return;
    }
    const patch: Record<string, unknown> = {};
    if (draft.name !== currentAgent.name) patch.name = draft.name;
    if (draft.alias !== currentAgent.slug) patch.alias = draft.alias;
    if (draft.description !== currentAgent.description) patch.description = draft.description;
    if (draft.systemPrompt !== currentAgent.systemPrompt) patch.systemPrompt = draft.systemPrompt;
    if (draft.permissionMode !== currentAgent.permissionMode) patch.permissionMode = draft.permissionMode;
    if (draft.toolProfile !== (currentAgent.toolProfile ?? "readonly")) patch.toolProfile = draft.toolProfile;
    if (!sameCapabilities(draft.capabilities, currentAgent.capabilities ?? [])) {
      patch.capabilities = draft.capabilities;
    }
    if (draft.avatarKind !== currentAgent.avatarKind || draft.avatarValue !== currentAgent.avatarValue) {
      patch.avatarKind = draft.avatarKind;
      patch.avatarValue = draft.avatarValue;
    }
    if (Object.keys(patch).length === 0) {
      setStatus("没有需要保存的修改。");
      setIsSaving(false);
      cancelEdit();
      return;
    }
    try {
      const response = await fetch(`/api/agents/${currentAgent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      const payload = (await response.json()) as { agent?: AgentSummary; error?: string };
      if (!response.ok || !payload.agent) {
        setStatus(payload.error ?? "保存失败。");
        setIsSaving(false);
        return;
      }
      setCurrentAgent(payload.agent);
      setStatus("已保存。");
      setMode({ kind: "detail", agentId: payload.agent.id, precheck: null });
      void loadPrecheck(payload.agent.id);
      await loadList();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "保存失败。");
    } finally {
      setIsSaving(false);
    }
  }

  async function regenerate() {
    if (!currentAgent) return;
    setStatus("重新生成 profile（V3.6 C4 实现）");
  }

  async function startDelete() {
    if (!currentAgent) return;
    setStatus("");
    try {
      const response = await fetch(`/api/agents/${currentAgent.id}/precheck-delete`);
      const payload = (await response.json()) as { precheck?: AgentDeletePrecheck; error?: string };
      if (!response.ok || !payload.precheck) {
        setStatus(payload.error ?? "删除预检失败。");
        return;
      }
      if (!payload.precheck.canDelete) {
        setStatus(`还有 ${payload.precheck.activeRunCount} 个未完成 run，请先取消或等待。`);
        return;
      }
      setDeleteConfirm({ precheck: payload.precheck });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "删除预检失败。");
    }
  }

  async function confirmDelete() {
    if (!currentAgent || !deleteConfirm) return;
    setIsDeleting(true);
    setStatus("删除中...");
    try {
      const response = await fetch(`/api/agents/${currentAgent.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setStatus(payload.error ?? "删除失败。");
        setIsDeleting(false);
        return;
      }
      setCurrentAgent(null);
      setDraft(emptyDraft());
      setDeleteConfirm(null);
      setStatus("已删除。");
      setMode({ kind: "list" });
      await loadList();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "删除失败。");
    } finally {
      setIsDeleting(false);
    }
  }

  function cancelDelete() {
    if (isDeleting) return;
    setDeleteConfirm(null);
  }

  return (
    <section>
      <h3>自建 Agent</h3>
      <p className="desc">查看、编辑、删除通过 /agent-creator 创建的自建 Agent。</p>

      {mode.kind === "list" ? (
        <AgentListPanel
          agents={agents}
          error={error}
          isLoading={isLoading}
          onEdit={(agentId) => {
            void openEditFromList(agentId);
          }}
          onSelect={(agentId) => {
            void openDetail(agentId);
          }}
        />
      ) : null}

      {mode.kind === "detail" && currentAgent ? (
        <AgentDetailPanel
          data={currentAgent}
          precheck={mode.precheck}
          onBack={() => {
            setCurrentAgent(null);
            setDeleteConfirm(null);
            setStatus("");
            setMode({ kind: "list" });
          }}
          onDelete={() => {
            void startDelete();
          }}
          onEdit={openEdit}
          onRegenerate={() => {
            void regenerate();
          }}
        />
      ) : null}

      {mode.kind === "edit" && currentAgent ? (
        <AgentEditPanel
          data={currentAgent}
          draft={draft}
          fieldErrors={fieldErrors}
          isSaving={isSaving}
          onCancel={cancelEdit}
          onChange={(patch) => setDraft((value) => ({ ...value, ...patch }))}
          onRegenerate={() => {
            void regenerate();
          }}
          onSave={() => {
            void saveEdit();
          }}
        />
      ) : null}

      {status ? <p className="desc tight" style={{ marginTop: 8 }}>{status}</p> : null}

      {deleteConfirm && currentAgent ? (
        <AgentDeleteConfirm
          data={currentAgent}
          precheck={deleteConfirm.precheck}
          isDeleting={isDeleting}
          onCancel={cancelDelete}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      ) : null}
    </section>
  );
}

function validateDraft(draft: AgentFormDraft): AgentFormErrors {
  const errors: AgentFormErrors = {};
  if (!draft.name.trim()) errors.name = "名称不能为空。";
  if (draft.name.length > 48) errors.name = "名称不能超过 48 字符。";
  if (!/^[a-z][a-z0-9-]*$/.test(draft.alias) || draft.alias.length < 2 || draft.alias.length > 32) {
    errors.alias = "alias 只能包含小写字母、数字与短横线，且以字母开头（2-32 字符）。";
  }
  if (!draft.description.trim()) errors.description = "描述不能为空。";
  if (draft.description.length > 240) errors.description = "描述不能超过 240 字符。";
  if (!draft.systemPrompt.trim()) errors.systemPrompt = "System Prompt 不能为空。";
  if (draft.systemPrompt.length > 8000) errors.systemPrompt = "System Prompt 不能超过 8000 字符。";
  return errors;
}

function sameCapabilities(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((tag) => set.has(tag));
}

function RuntimeLine({
  info
}: {
  info?: { modelName: string; source: string; message: string };
}) {
  return (
    <p className="desc tight">
      Runtime：{info?.modelName ?? "unknown"} · {info?.source ?? "unknown"} ·{" "}
      {info?.message ?? "等待探测"}
    </p>
  );
}

function HealthRow({ detail, name, ok = false }: { detail: string; name: string; ok?: boolean }) {
  return (
    <div className="health-row">
      {ok ? <CheckCircle2 className="ok" size={16} /> : <span className="health-missing" />}
      <div>
        <strong>{name}</strong>
        <p>{detail}</p>
      </div>
      <span className="tag">{ok ? "可用" : "待配置"}</span>
    </div>
  );
}

function formatProtocol(protocol: ProviderProtocol) {
  return protocol === "openai_compatible" ? "OpenAI Compatible" : "Anthropic Compatible";
}

function formatStatus(status: ProviderStatus) {
  if (status === "ok") {
    return "可用";
  }

  if (status === "error") {
    return "失败";
  }

  return "未检测";
}

function emptyProviderDraft(): ProviderDraft {
  return {
    name: "",
    protocol: "openai_compatible",
    baseUrl: "",
    apiKey: "",
    defaultModel: "",
    enabled: true
  };
}

function providerToDraft(provider: ProviderSummary): ProviderDraft {
  return {
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    apiKey: "",
    defaultModel: provider.defaultModel,
    enabled: provider.enabled
  };
}

function formatCheckedAt(provider?: ProviderSummary) {
  if (!provider?.lastCheckedAt) {
    return "未检测";
  }

  return new Date(provider.lastCheckedAt).toLocaleString("zh-CN");
}
