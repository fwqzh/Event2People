"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { RefreshStatusSnapshot } from "@/lib/refresh-progress";

type HeaderRefreshButtonProps = {
  lastUpdatedLabel: string | null;
};

const POLL_INTERVAL_MS = 1500;

export function HeaderRefreshButton({ lastUpdatedLabel }: HeaderRefreshButtonProps) {
  const router = useRouter();
  const pollTimerRef = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<RefreshStatusSnapshot | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [status, setStatus] = useState("");

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
            router.refresh();
          }
          return;
        }

        pollTimerRef.current = window.setTimeout(() => {
          void tick();
        }, POLL_INTERVAL_MS);
      } catch (error) {
        stopPolling();
        setStatus(error instanceof Error ? error.message : "刷新状态获取失败");
      }
    };

    void tick();
  }

  const syncInitialSnapshot = useEffectEvent(async () => {
    try {
      const latestSnapshot = await fetchSnapshot();
      setSnapshot(latestSnapshot);
      if (latestSnapshot?.status === "RUNNING") {
        schedulePoll(latestSnapshot.runId);
      }
    } catch {
      return;
    }
  });

  useEffect(() => {
    void syncInitialSnapshot();

    return () => {
      stopPolling();
    };
  }, []);

  async function handleRefresh() {
    if (isPolling || snapshot?.status === "RUNNING") {
      if (snapshot?.runId) {
        schedulePoll(snapshot.runId);
      }
      return;
    }

    setStatus("");

    try {
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
      setStatus(payload.message ?? "");

      if (nextSnapshot?.status === "RUNNING") {
        schedulePoll(nextSnapshot.runId);
        return;
      }

      if (nextSnapshot?.label) {
        setStatus(nextSnapshot.label);
      }
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "刷新失败");
    }
  }

  const isRefreshing = snapshot?.status === "RUNNING" || isPolling;
  const progress = snapshot?.status === "RUNNING" ? snapshot.progress : 0;
  const progressLabel = snapshot?.status === "RUNNING" ? snapshot.label : null;

  return (
    <div className="header-refresh">
      <button type="button" className="primary-button site-nav__button" disabled={isRefreshing} onClick={() => void handleRefresh()}>
        <span className="header-refresh__button-copy">
          <strong>{isRefreshing ? "刷新中…" : "Refresh"}</strong>
          <em>{lastUpdatedLabel ? `上次 ${lastUpdatedLabel}` : "暂无更新时间"}</em>
        </span>
      </button>

      {isRefreshing ? (
        <div className="header-refresh__progress" aria-live="polite">
          <div className="header-refresh__progress-copy">
            <span>{progressLabel ?? "正在刷新"}</span>
            <strong>{progress}%</strong>
          </div>
          <div className="header-refresh__progress-track">
            <div className="header-refresh__progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}

      {status ? <span className="header-refresh__status">{status}</span> : null}
    </div>
  );
}
