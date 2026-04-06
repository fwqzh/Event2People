"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { getRefreshSourceLabel, type RefreshSource, type RefreshStatusSnapshot } from "@/lib/refresh-progress";

type SourceRefreshButtonProps = {
  source: RefreshSource;
};

const POLL_INTERVAL_MS = 1500;

export function SourceRefreshButton({ source }: SourceRefreshButtonProps) {
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
        setStatus(error instanceof Error ? error.message : "刷新失败");
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source }),
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
  const isSourceRefreshing = isRefreshing && snapshot?.source === source;
  const isBlockedByOtherRefresh = isRefreshing && snapshot?.source !== source;
  const label = isSourceRefreshing
    ? `刷新中 ${snapshot?.progress ?? 0}%`
    : isBlockedByOtherRefresh
      ? "稍后"
      : "刷新";
  const statusText =
    !status && isBlockedByOtherRefresh && snapshot?.source
      ? `${getRefreshSourceLabel(snapshot.source)} 正在刷新`
      : status;

  return (
    <div className="section-refresh">
      <button
        type="button"
        className="ghost-button section-refresh__button"
        disabled={isRefreshing}
        onClick={() => void handleRefresh()}
        title={statusText || `${getRefreshSourceLabel(source)} 刷新`}
        aria-label={`${getRefreshSourceLabel(source)} ${label}`}
      >
        {label}
      </button>
      {statusText ? <span className="section-refresh__status">{statusText}</span> : null}
    </div>
  );
}
