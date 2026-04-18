"use client";

import { useState } from "react";

import type { TavilySettingsSnapshot } from "@/lib/runtime-settings";

type TavilySettingsPanelProps = {
  initialSnapshot: TavilySettingsSnapshot;
};

type TavilySettingsResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  settings?: TavilySettingsSnapshot;
};

function getSourceLabel(source: TavilySettingsSnapshot["source"]) {
  if (source === "saved") {
    return "当前使用本地设置";
  }

  if (source === "env") {
    return "当前回退到环境变量";
  }

  return "当前未配置";
}

export function TavilySettingsPanel({ initialSnapshot }: TavilySettingsPanelProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [draftKey, setDraftKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedKey = draftKey.trim();

    if (!trimmedKey) {
      setStatus("请先输入 Tavily API Key");
      return;
    }

    setIsSaving(true);
    setStatus("");

    try {
      const response = await fetch("/api/settings/tavily", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          tavilyApiKey: trimmedKey,
        }),
      });
      const payload = (await response.json()) as TavilySettingsResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "设置保存失败");
      }

      setSnapshot(payload.settings ?? snapshot);
      setDraftKey("");
      setStatus(payload.message ?? "Tavily API Key 已保存");
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
      const response = await fetch("/api/settings/tavily", {
        method: "DELETE",
        cache: "no-store",
      });
      const payload = (await response.json()) as TavilySettingsResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "设置清空失败");
      }

      setSnapshot(payload.settings ?? snapshot);
      setDraftKey("");
      setStatus(payload.message ?? "本地 Tavily API Key 已清空");
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
          <h2>Tavily API Key</h2>
          <p>当前项目会优先读取这里保存的本机配置，文件位于 `.local/settings.json`，不会回写 `.env`。</p>
        </div>
        <div className="settings-card__links">
          <a href="https://app.tavily.com/" target="_blank" rel="noreferrer" className="ghost-button">
            Tavily 控制台
          </a>
        </div>
      </div>

      <div className="settings-card__meta">
        <span className={`settings-card__meta-pill ${snapshot.configured ? "is-configured" : "is-empty"}`}>
          {getSourceLabel(snapshot.source)}
        </span>
        {snapshot.preview ? <span className="settings-card__meta-preview">{snapshot.preview}</span> : null}
      </div>

      <form className="settings-form" onSubmit={(event) => void handleSave(event)}>
        <label className="settings-form__field">
          <span>输入新的 Tavily Key</span>
          <input
            type="password"
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
            placeholder="tvly-..."
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <div className="settings-form__actions">
          <button type="submit" className="primary-button" disabled={isSaving}>
            {isSaving ? "保存中…" : "保存"}
          </button>
          <button type="button" className="ghost-button" disabled={isSaving} onClick={() => void handleClear()}>
            清空本地设置
          </button>
        </div>
      </form>

      {status ? <p className="status-text">{status}</p> : null}
    </section>
  );
}
