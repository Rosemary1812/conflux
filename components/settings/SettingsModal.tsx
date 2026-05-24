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
import { useEffect, useState } from "react";
import { mockProviders, type MockProvider } from "@/lib/mock/providers";
type SettingsModalProps = {
  onClose: () => void;
  open: boolean;
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
  const [checking, setChecking] = useState(false);

  async function refreshHealth() {
    setChecking(true);

    try {
      const response = await fetch("/api/agents/health");
      const payload = (await response.json()) as {
        health?: Array<{ platform: string; ok: boolean; message: string }>;
      };

      setHealth(
        Object.fromEntries(
          (payload.health ?? []).map((item) => [item.platform, { ok: item.ok, message: item.message }])
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
        <HealthRow detail={health.codex?.message ?? "等待检测"} name="Codex" ok={health.codex?.ok} />
        <HealthRow detail={health.hermes?.message ?? "等待检测"} name="Hermes" ok={health.hermes?.ok} />
        <HealthRow detail={health.opencode?.message ?? "等待检测"} name="OpenCode" ok={health.opencode?.ok} />
      </div>
    </section>
  );
}

function OrchestratorPanel() {
  return (
    <section>
      <h3>Orchestrator</h3>
      <p className="desc">V2 才会启用真实编排；这里先展示它将如何从已保存 Provider 中选择模型服务。</p>
      <div className="settings-card">
        <label className="field-label">默认 Provider</label>
        <select>
          {mockProviders.map((provider) => (
            <option key={provider.id}>
              {provider.name} · {provider.defaultModel}
            </option>
          ))}
        </select>
        <label className="field-label">本次编排模型</label>
        <input defaultValue={mockProviders[0].defaultModel} />
        <p className="desc tight">Provider 的 API Key、Base URL 和协议在“Provider 与密钥”中维护。</p>
      </div>
    </section>
  );
}

function ProvidersPanel() {
  const [selectedProviderId, setSelectedProviderId] = useState(mockProviders[0].id);
  const selectedProvider =
    mockProviders.find((provider) => provider.id === selectedProviderId) ?? mockProviders[0];

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
            <button className="primary-button compact" type="button">
              <Plus size={14} />
              新增
            </button>
          </div>
          <div className="provider-list">
            {mockProviders.map((provider) => (
              <button
                className={
                  selectedProvider.id === provider.id ? "provider-row active" : "provider-row"
                }
                key={provider.id}
                onClick={() => setSelectedProviderId(provider.id)}
                type="button"
              >
                <span>
                  <strong>{provider.name}</strong>
                  <small>{formatProtocol(provider.protocol)}</small>
                </span>
                <span className={`provider-status ${provider.status}`}>
                  {formatStatus(provider.status)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="provider-detail-panel">
          <div className="provider-detail-head">
            <div>
              <h4>{selectedProvider.name}</h4>
              <p>{selectedProvider.enabled ? "已启用" : "已停用"} · {selectedProvider.lastCheckedAt}</p>
            </div>
            <div className="inline-actions">
              <button aria-label="编辑 Provider" className="secondary-icon-button" type="button">
                <Pencil size={15} />
              </button>
              <button aria-label="删除 Provider" className="secondary-icon-button danger" type="button">
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          <div className="settings-card form-stack provider-form">
            <label>
              名称
              <input defaultValue={selectedProvider.name} key={`${selectedProvider.id}-name`} />
            </label>
            <label>
              API 协议
              <select defaultValue={selectedProvider.protocol} key={`${selectedProvider.id}-protocol`}>
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="anthropic-compatible">Anthropic Compatible</option>
              </select>
            </label>
            <label>
              Base URL
              <input defaultValue={selectedProvider.baseUrl} key={`${selectedProvider.id}-baseUrl`} />
            </label>
            <label>
              API Key
              <input
                defaultValue={selectedProvider.maskedKey}
                key={`${selectedProvider.id}-apiKey`}
                type="password"
              />
            </label>
            <label>
              默认模型
              <input
                defaultValue={selectedProvider.defaultModel}
                key={`${selectedProvider.id}-model`}
              />
            </label>
            <div className="setting-row no-border">
              <div>
                <strong>启用 Provider</strong>
                <p>停用后不会出现在 Orchestrator 或自建 Agent 的选择列表中。</p>
              </div>
              <button
                aria-pressed={selectedProvider.enabled}
                className={selectedProvider.enabled ? "toggle on" : "toggle"}
                type="button"
              />
            </div>
            <div className="inline-actions end">
              <button className="secondary-button" type="button">测试连接</button>
              <button className="primary-button" type="button">保存 Provider</button>
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

function CustomAgentsPanel() {
  return (
    <section>
      <h3>自建 Agent</h3>
      <p className="desc">V1 不执行自建 Agent，只保留未来配置形态。</p>
      <div className="agent-card-mini">
        <span className="avatar">RA</span>
        <div>
          <strong>React 助手</strong>
          <p>Default Provider · UI 优化 / React 改造</p>
        </div>
      </div>
      <div className="settings-card form-stack">
        <label>名称<input defaultValue="React 助手" /></label>
        <label>Provider<select><option>Default Provider</option></select></label>
        <label>System Prompt<textarea defaultValue="你是 React 组件专家。优先给出可直接应用的 UI 代码修改。" /></label>
      </div>
    </section>
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

function formatProtocol(protocol: MockProvider["protocol"]) {
  return protocol === "openai-compatible" ? "OpenAI Compatible" : "Anthropic Compatible";
}

function formatStatus(status: MockProvider["status"]) {
  if (status === "ok") {
    return "可用";
  }

  if (status === "error") {
    return "失败";
  }

  return "未检测";
}
