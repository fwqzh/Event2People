"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { decodeRefreshProgress } from "@/lib/refresh-progress";
import type { RefreshStatusSnapshot } from "@/lib/refresh-progress";

type AdminRefreshPanelProps = {
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

export function AdminRefreshPanel({ aiEnabled, aiModel, runs }: AdminRefreshPanelProps) {
  const router = useRouter();
  const pollTimerRef = useRef<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [snapshot, setSnapshot] = useState<RefreshStatusSnapshot | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [status, setStatus] = useState("");

  function refreshPage() {
    startTransition(() => {
      router.refresh();
    });
  }

  function stopPolling() {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setIsPolling(false);
  }

  async function fetchSnapshot(runId?: string | null) {
    const search = runId ? `?runId=${encodeURIComponent(runId)}` : "";
    const response = await fetch(`/api/admin/refresh${search}`, {
      method: "GET",
      cache: "no-store",
    });
    const payload = await response.json();
    return (payload.snapshot as RefreshStatusSnapshot | null) ?? null;
  }

  function schedulePoll(runId?: string | null) {
    stopPolling();
    setIsPolling(true);

    const tick = async () => {
      try {
        const nextSnapshot = await fetchSnapshot(runId);
        setSnapshot(nextSnapshot);

        if (!nextSnapshot || nextSnapshot.status !== "RUNNING") {
          stopPolling();
          if (nextSnapshot?.label) {
            setStatus(nextSnapshot.label);
          }
          if (nextSnapshot?.status === "SUCCESS") {
            refreshPage();
          }
          return;
        }

        pollTimerRef.current = window.setTimeout(() => {
          void tick();
        }, 1500);
      } catch (error) {
        stopPolling();
        setStatus(error instanceof Error ? error.message : "刷新状态获取失败");
      }
    };

    void tick();
  }

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    void (async () => {
      try {
        const latestSnapshot = await fetchSnapshot();
        setSnapshot(latestSnapshot);
        if (latestSnapshot?.status === "RUNNING") {
          schedulePoll(latestSnapshot.runId);
        }
      } catch {
        return;
      }
    })();

    return () => {
      stopPolling();
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  async function handleRefresh() {
    if (isPolling || snapshot?.status === "RUNNING") {
      if (snapshot?.runId) {
        schedulePoll(snapshot.runId);
      }
      return;
    }

    setStatus("");
    const response = await fetch("/api/admin/refresh", {
      method: "POST",
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.error ?? "刷新失败");
      return;
    }

    const nextSnapshot = (payload.snapshot as RefreshStatusSnapshot | null) ?? null;
    setSnapshot(nextSnapshot);
    setStatus(payload.message ?? "刷新已开始");

    if (nextSnapshot?.status === "RUNNING") {
      schedulePoll(nextSnapshot.runId);
      return;
    }

    if (nextSnapshot?.label) {
      setStatus(nextSnapshot.label);
    }
    refreshPage();
  }

  const isRefreshing = isPolling || snapshot?.status === "RUNNING";

  return (
    <div className="admin-card">
      <div className="toolbar-card toolbar-card--compact">
        <div>
          <span className="section-kicker">DATA OPS</span>
          <h2>Refresh Dataset</h2>
          <p>手动触发 ingest → parse → normalize → link → enrich → validate → publish。</p>
          <p>后台已配置为每 60 分钟自动刷新一次。</p>
          <p>{aiEnabled ? `OpenAI enrichment 已启用：${aiModel}` : "当前未配置 OPENAI_API_KEY，刷新会回退到模板文案。"}</p>
          {isRefreshing && snapshot ? <p>当前进度：{snapshot.label}</p> : null}
        </div>
        <button type="button" className="primary-button" disabled={isPending || isRefreshing} onClick={() => void handleRefresh()}>
          {isRefreshing || isPending ? "刷新中…" : "立即刷新"}
        </button>
      </div>

      <div className="refresh-run-list">
        {runs.map((run) => (
          <article key={run.id} className="refresh-run-card">
            <div>
              <strong>{run.status}</strong>
              <p>{run.trigger}</p>
            </div>
            <span>{decodeRefreshProgress(run.message, run.status as "RUNNING" | "SUCCESS" | "FAILED").label}</span>
          </article>
        ))}
      </div>

      {status ? <p className="status-text">{status}</p> : null}
    </div>
  );
}
