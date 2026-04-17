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
  }, [activeSnapshot]);

  useEffect(() => {
    setStatus("");
  }, [selectedProviderId]);

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
          <h2>大模型 API Key</h2>
          <p>选平台，粘贴 API Key，保存。</p>
        </div>
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
            <strong>{snapshot.label}</strong>
            {snapshot.configured ? <em>{getProviderChoiceHint(snapshot)}</em> : null}
          </button>
        ))}
      </div>

      <div className="settings-provider-panel">
        <h3>{activeSnapshot.label}</h3>
        {activeSnapshot.configured ? <p className="settings-provider-panel__status">已保存</p> : null}

        <form className="settings-form" onSubmit={(event) => void handleSave(event)}>
          <label className="settings-form__field">
            <span>{activeSnapshot.label} API Key</span>
            <input
              type="password"
              value={draftApiKey}
              onChange={(event) => setDraftApiKey(event.target.value)}
              placeholder={activeProvider.apiKeyPlaceholder}
              autoComplete="off"
              spellCheck={false}
            />
            <small className="settings-form__hint">只填这一项就可以。</small>
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

          <details className="settings-advanced">
            <summary>更多设置（可选）</summary>

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
            </label>
          </details>
        </form>
      </div>

      {status ? <p className="status-text">{status}</p> : null}
    </section>
  );
}
