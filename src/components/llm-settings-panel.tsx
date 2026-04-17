"use client";

import { useEffect, useMemo, useState } from "react";

import { getLlmProviderDefinition, type LlmProviderId } from "@/lib/llm-providers";
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

function getProviderSaveHint(snapshot: LlmProviderSettingsSnapshot) {
  if (snapshot.runtimeReady) {
    return "保存后，当前项目会优先使用这里的配置。";
  }

  return "当前项目还没直接接这个平台，但可以先把 Key 存在这里。";
}

function getProviderChoiceHint(snapshot: LlmProviderSettingsSnapshot) {
  if (snapshot.configured) {
    return "已保存";
  }

  return "只填 Key 也行";
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
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [status, setStatus] = useState("");

  const activeSnapshot = useMemo(
    () => snapshots.find((snapshot) => snapshot.id === selectedProviderId) ?? snapshots[0],
    [selectedProviderId, snapshots],
  );
  const activeProvider = useMemo(() => getLlmProviderDefinition(activeSnapshot.id), [activeSnapshot.id]);

  useEffect(() => {
    const nextDraft = toInitialDraft(activeSnapshot);
    setDraftApiKey(nextDraft.apiKey);
    setDraftBaseUrl(nextDraft.baseUrl);
    setDraftModel(nextDraft.model);
    setIsAdvancedOpen(activeSnapshot.baseUrlSource !== "none" || activeSnapshot.modelSource === "saved" || activeSnapshot.modelSource === "env");
  }, [activeSnapshot]);

  useEffect(() => {
    setStatus("");
  }, [selectedProviderId]);

  const configuredCount = snapshots.filter((snapshot) => snapshot.configured).length;

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedApiKey = draftApiKey.trim();
    const trimmedBaseUrl = draftBaseUrl.trim();
    const trimmedModel = draftModel.trim();

    if (!trimmedApiKey && !trimmedBaseUrl && !trimmedModel) {
      setStatus("如果你只有 API Key，只需要填写第一项，然后点保存。");
      return;
    }

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
          apiKey: trimmedApiKey,
          baseUrl: trimmedBaseUrl,
          model: trimmedModel,
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
          <h2>大模型 API</h2>
          <p>如果你手里只有一个 API Key，也够用。先选平台，把 Key 粘贴进去，再点保存，其他选项都可以先不填。</p>
        </div>
      </div>

      <div className="settings-guide">
        <div className="settings-guide__step">
          <strong>1. 选平台</strong>
          <p>选和你拿到 API Key 的平台同名的那个。</p>
        </div>
        <div className="settings-guide__step">
          <strong>2. 贴 Key</strong>
          <p>只填 API Key 就能保存，Base URL 和模型名先留空也没关系。</p>
        </div>
        <div className="settings-guide__step">
          <strong>3. 点保存</strong>
          <p>配置只保存在这台电脑，不会改你的 `.env` 文件。</p>
        </div>
      </div>

      <div className="settings-card__meta">
        <span className={`settings-card__meta-pill ${configuredCount > 0 ? "is-configured" : "is-empty"}`}>
          {configuredCount} / {snapshots.length} 已配置 API Key
        </span>
        <span className="settings-card__meta-preview">不知道填什么时，只填 API Key 就好</span>
      </div>

      <div className="settings-provider-grid" aria-label="大模型 Provider 选择">
        {snapshots.map((snapshot) => (
          <button
            key={snapshot.id}
            type="button"
            aria-pressed={selectedProviderId === snapshot.id}
            className={`settings-provider-chip ${selectedProviderId === snapshot.id ? "is-active" : ""} ${
              snapshot.configured ? "is-configured" : ""
            }`}
            onClick={() => setSelectedProviderId(snapshot.id)}
          >
            <div className="settings-provider-chip__copy">
              <strong>{snapshot.label}</strong>
              <p>{snapshot.runtimeReady ? "当前项目可直接使用" : "先保存起来，后续可复用"}</p>
            </div>
            <em>{getProviderChoiceHint(snapshot)}</em>
          </button>
        ))}
      </div>

      <div className="settings-provider-panel">
        <div className="settings-provider-panel__header">
          <div>
            <span className="section-kicker">Current Provider</span>
            <h3>{activeSnapshot.label}</h3>
            <p>{getProviderSaveHint(activeSnapshot)}</p>
          </div>
          <span className={`settings-provider-badge ${activeSnapshot.runtimeReady ? "is-ready" : ""}`}>{activeSnapshot.badge}</span>
        </div>

        <div className="settings-card__meta">
          <span className={`settings-card__meta-pill ${activeSnapshot.configured ? "is-configured" : "is-empty"}`}>
            {getApiKeySourceLabel(activeSnapshot)}
          </span>
          <span className="settings-card__meta-preview">{activeSnapshot.preview ?? "尚未配置 API Key"}</span>
        </div>

        <form className="settings-form" onSubmit={(event) => void handleSave(event)}>
          <label className="settings-form__field">
            <span>API Key</span>
            <input
              type="password"
              value={draftApiKey}
              onChange={(event) => setDraftApiKey(event.target.value)}
              placeholder={activeProvider.apiKeyPlaceholder}
              autoComplete="off"
              spellCheck={false}
            />
            <small className="settings-form__hint">如果你现在只拿到了一个 Key，填这一项就够了。</small>
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

          <details
            className="settings-advanced"
            open={isAdvancedOpen}
            onToggle={(event) => setIsAdvancedOpen(event.currentTarget.open)}
          >
            <summary>高级选项（大多数人不用填）</summary>
            <p>只有你在用代理网关，或者想固定模型名时，再展开填写。</p>

            <label className="settings-form__field">
              <span>Base URL / 网关地址</span>
              <input
                type="text"
                value={draftBaseUrl}
                onChange={(event) => setDraftBaseUrl(event.target.value)}
                placeholder={activeProvider.baseUrlPlaceholder}
                autoComplete="off"
                spellCheck={false}
              />
              <small className="settings-form__hint">
                当前值：{activeSnapshot.baseUrl || "未填写"} · {getValueSourceLabel(activeSnapshot.baseUrlSource)}
              </small>
            </label>

            <label className="settings-form__field">
              <span>默认模型 ID</span>
              <input
                type="text"
                value={draftModel}
                onChange={(event) => setDraftModel(event.target.value)}
                placeholder={activeProvider.modelPlaceholder}
                autoComplete="off"
                spellCheck={false}
              />
              <small className="settings-form__hint">
                当前值：{activeSnapshot.model || "未填写"} · {getValueSourceLabel(activeSnapshot.modelSource)}
              </small>
            </label>

            <div className="settings-provider-notes">
              <p>
                API Key 环境变量：
                <code>{activeSnapshot.envAliases.apiKey.join(" / ")}</code>
              </p>
              <p>
                Base URL 环境变量：
                <code>{activeSnapshot.envAliases.baseUrl.join(" / ") || "无"}</code>
              </p>
              <p>
                Model 环境变量：
                <code>{activeSnapshot.envAliases.model.join(" / ") || "无"}</code>
              </p>
            </div>
          </details>
        </form>
      </div>

      {status ? <p className="status-text">{status}</p> : null}
    </section>
  );
}
