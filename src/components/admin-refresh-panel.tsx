"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type AdminRefreshPanelProps = {
  authorized: boolean;
  aiEnabled: boolean;
  aiModel: string | null;
  runs: Array<{
    id: string;
    trigger: string;
    status: string;
    message: string | null;
    startedAt: Date;
    finishedAt: Date | null;
  }>;
};

export function AdminRefreshPanel({ authorized, aiEnabled, aiModel, runs }: AdminRefreshPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState("");

  function refreshPage() {
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleLogin() {
    setStatus("");
    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.error ?? "鉴权失败");
      return;
    }

    setStatus("鉴权成功");
    refreshPage();
  }

  async function handleRefresh() {
    setStatus("");
    const response = await fetch("/api/admin/refresh", {
      method: "POST",
    });
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.error ?? "刷新失败");
      return;
    }

    setStatus(payload.message ?? "刷新完成");
    refreshPage();
  }

  if (!authorized) {
    return (
      <div className="admin-card">
        <span className="section-kicker">PROTECTED</span>
        <h2>Admin Refresh</h2>
        <p>输入 `ADMIN_REFRESH_SECRET` 后才能触发刷新任务。</p>
        <p>{aiEnabled ? `OpenAI 已配置，模型：${aiModel}` : "未配置 OPENAI_API_KEY，将仅使用模板文案。"}</p>
        <div className="admin-form">
          <input value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="输入刷新密钥" type="password" />
          <button type="button" className="primary-button" onClick={() => void handleLogin()}>
            登录
          </button>
        </div>
        {status ? <p className="status-text">{status}</p> : null}
      </div>
    );
  }

  return (
    <div className="admin-card">
      <div className="toolbar-card toolbar-card--compact">
        <div>
          <span className="section-kicker">DATA OPS</span>
          <h2>Refresh Dataset</h2>
          <p>手动触发 ingest → parse → normalize → link → enrich → validate → publish。</p>
          <p>{aiEnabled ? `OpenAI enrichment 已启用：${aiModel}` : "当前未配置 OPENAI_API_KEY，刷新会回退到模板文案。"}</p>
        </div>
        <button type="button" className="primary-button" disabled={isPending} onClick={() => void handleRefresh()}>
          {isPending ? "刷新中…" : "立即刷新"}
        </button>
      </div>

      <div className="refresh-run-list">
        {runs.map((run) => (
          <article key={run.id} className="refresh-run-card">
            <div>
              <strong>{run.status}</strong>
              <p>{run.trigger}</p>
            </div>
            <span>{run.message ?? "无附加信息"}</span>
          </article>
        ))}
      </div>

      {status ? <p className="status-text">{status}</p> : null}
    </div>
  );
}
