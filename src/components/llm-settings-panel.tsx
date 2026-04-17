"use client";

import { useEffect, useMemo, useState } from "react";

import type { LlmProviderId } from "@/lib/llm-providers";
import type { LlmProviderSettingsSnapshot } from "@/lib/runtime-settings";

type LlmSettingsPanelProps = {
  initialSnapshots: LlmProviderSettingsSnapshot[];
};

type LlmSettingsResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  settings?: LlmProviderSettingsSnapshot[];
};

function getApiKeySourceLabel(snapshot: LlmProviderSettingsSnapshot) {
  if (snapshot.apiKeySource === "saved") {
    return "当前使用本地 API Key";
  }

  if (snapshot.apiKeySource === "env") {
    return "当前回退到环境变量";
  }

  return "当前未配置 API Key";
}

function getValueSourceLabel(source: LlmProviderSettingsSnapshot["baseUrlSource"] | LlmProviderSettingsSnapshot["modelSource"]) {
  if (source === "saved") {
    return "本地设置";
  }

  if (source === "env") {
    return "环境变量";
  }

  if (source === "default") {
    return "默认值";
  }

  return "未设置";
}

function toInitialDraft(snapshot: LlmProviderSettingsSnapshot | undefined) {
  return {
    apiKey: "",
    baseUrl: snapshot?.baseUrlSource === "none" ? "" : snapshot?.baseUrl ?? "",
    model: snapshot?.modelSource === "none" ? "" : snapshot?.model ?? "",
  };
}

export function LlmSettingsPanel({ initialSnapshots }: LlmSettingsPanelProps) {
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [selectedProviderId, setSelectedProviderId] = useState<LlmProviderId>(
    initialSnapshots.find((snapshot) => snapshot.runtimeReady && snapshot.configured)?.id ??
      initialSnapshots.find((snapshot) => snapshot.configured)?.id ??
      "openai",
  );
  const [draftApiKey, setDraftApiKey] = useState("");
  const [draftBaseUrl, setDraftBaseUrl] = useState(() => toInitialDraft(initialSnapshots[0]).baseUrl);
  const [draftModel, setDraftModel] = useState(() => toInitialDraft(initialSnapshots[0]).model);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");

  const activeSnapshot = useMemo(
    () => snapshots.find((snapshot) => snapshot.id === selectedProviderId) ?? snapshots[0],
    [selectedProviderId, snapshots],
  );

  useEffect(() => {
    const nextDraft = toInitialDraft(activeSnapshot);
    setDraftApiKey(nextDraft.apiKey);
    setDraftBaseUrl(nextDraft.baseUrl);
    setDraftModel(nextDraft.model);
  }, [activeSnapshot]);

  useEffect(() => {
    setStatus("");
  }, [selectedProviderId]);

  const configuredCount = snapshots.filter((snapshot) => snapshot.configured).length;

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSaving(true);
    setStatus("");

    try {
      const response = await fetch("/api/settings/llm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          providerId: activeSnapshot.id,
          apiKey: draftApiKey,
          baseUrl: draftBaseUrl,
          model: draftModel,
        }),
      });
      const payload = (await response.json()) as LlmSettingsResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "设置保存失败");
      }

      setSnapshots(payload.settings ?? snapshots);
      setDraftApiKey("");
      setStatus(payload.message ?? `${activeSnapshot.label} 配置已保存`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "设置保存失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClear() {
    setIsSaving(true);
    setStatus("");

    try {
      const response = await fetch("/api/settings/llm", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          providerId: activeSnapshot.id,
        }),
      });
      const payload = (await response.json()) as LlmSettingsResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "设置清空失败");
      }

      setSnapshots(payload.settings ?? snapshots);
      setDraftApiKey("");
      setStatus(payload.message ?? `${activeSnapshot.label} 本地配置已清空`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "设置清空失败");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="board-section settings-card">
      <div className="settings-card__header">
        <div>
          <span className="section-kicker">Runtime Settings</span>
          <h2>大模型 API Providers</h2>
          <p>
            这里统一保存主流大模型平台的 API Key、Base URL 和默认模型。本机配置会写入 `.local/settings.json`，不会回写
            `.env`。
          </p>
          <p>当前项目现阶段会直接读取 OpenAI 配置；其他 Provider 先作为统一接入口保存，后续接入调用链时可直接复用。</p>
        </div>
      </div>

      <div className="settings-card__meta">
        <span className={`settings-card__meta-pill ${configuredCount > 0 ? "is-configured" : "is-empty"}`}>
          {configuredCount} / {snapshots.length} 已配置 API Key
        </span>
        <span className="settings-card__meta-preview">本地设置优先于环境变量，清空后会自动回退</span>
      </div>

      <div className="settings-provider-grid" role="tablist" aria-label="大模型 Provider 选择">
        {snapshots.map((snapshot) => (
          <button
            key={snapshot.id}
            type="button"
            role="tab"
            aria-selected={selectedProviderId === snapshot.id}
            className={`settings-provider-chip ${selectedProviderId === snapshot.id ? "is-active" : ""} ${
              snapshot.configured ? "is-configured" : ""
            }`}
            onClick={() => setSelectedProviderId(snapshot.id)}
          >
            <strong>{snapshot.label}</strong>
            <span>{snapshot.badge}</span>
            <em>{snapshot.configured ? "已配置" : "未配置"}</em>
          </button>
        ))}
      </div>

      <div className="settings-provider-panel">
        <div className="settings-provider-panel__header">
          <div>
            <span className="section-kicker">Selected Provider</span>
            <h3>{activeSnapshot.label}</h3>
            <p>{activeSnapshot.description}</p>
          </div>
          <span className={`settings-provider-badge ${activeSnapshot.runtimeReady ? "is-ready" : ""}`}>{activeSnapshot.badge}</span>
        </div>

        <div className="settings-card__meta">
          <span className={`settings-card__meta-pill ${activeSnapshot.configured ? "is-configured" : "is-empty"}`}>
            {getApiKeySourceLabel(activeSnapshot)}
          </span>
          <span className="settings-card__meta-preview">{activeSnapshot.preview ?? "尚未配置 API Key"}</span>
          <span className="settings-card__meta-preview">
            Base URL：{activeSnapshot.baseUrl || "未填写"} · {getValueSourceLabel(activeSnapshot.baseUrlSource)}
          </span>
          <span className="settings-card__meta-preview">
            Model：{activeSnapshot.model || "未填写"} · {getValueSourceLabel(activeSnapshot.modelSource)}
          </span>
        </div>

        <div className="settings-provider-notes">
          <p>
            环境变量别名：
            <code>{activeSnapshot.envAliases.apiKey.join(" / ")}</code>
          </p>
          <p>
            Base URL 别名：
            <code>{activeSnapshot.envAliases.baseUrl.join(" / ") || "无"}</code>
          </p>
          <p>
            Model 别名：
            <code>{activeSnapshot.envAliases.model.join(" / ") || "无"}</code>
          </p>
        </div>

        <form className="settings-form" onSubmit={(event) => void handleSave(event)}>
          <label className="settings-form__field">
            <span>输入新的 API Key</span>
            <input
              type="password"
              value={draftApiKey}
              onChange={(event) => setDraftApiKey(event.target.value)}
              placeholder={`输入 ${activeSnapshot.label} API Key`}
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="settings-form__field">
            <span>Base URL / 网关地址</span>
            <input
              type="text"
              value={draftBaseUrl}
              onChange={(event) => setDraftBaseUrl(event.target.value)}
              placeholder={activeSnapshot.id === "openai" ? "可选：OpenAI 兼容网关地址" : "可选：代理或兼容网关地址"}
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="settings-form__field">
            <span>默认模型 ID</span>
            <input
              type="text"
              value={draftModel}
              onChange={(event) => setDraftModel(event.target.value)}
              placeholder={activeSnapshot.id === "openai" ? "如 gpt-5-mini" : "填写你实际使用的模型 ID"}
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <div className="settings-form__actions">
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={isSaving || !activeSnapshot.saved}
              onClick={() => void handleClear()}
            >
              清空本地设置
            </button>
          </div>
        </form>
      </div>

      {status ? <p className="status-text">{status}</p> : null}
    </section>
  );
}
