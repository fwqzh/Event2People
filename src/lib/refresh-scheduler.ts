import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { runRefresh } from "@/lib/refresh";

type RefreshSchedulerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

const globalForRefreshScheduler = globalThis as typeof globalThis & {
  __event2peopleRefreshScheduler?: RefreshSchedulerState;
};

function getSchedulerState() {
  if (!globalForRefreshScheduler.__event2peopleRefreshScheduler) {
    globalForRefreshScheduler.__event2peopleRefreshScheduler = {
      started: false,
      running: false,
      timer: null,
    };
  }

  return globalForRefreshScheduler.__event2peopleRefreshScheduler;
}

async function runScheduledRefresh() {
  const state = getSchedulerState();

  if (state.running) {
    return;
  }

  state.running = true;

  try {
    await runRefresh(prisma, "scheduled");
  } catch (error) {
    console.warn("scheduled refresh failed:", error instanceof Error ? error.message : "unknown error");
  } finally {
    state.running = false;
  }
}

export function startRefreshScheduler() {
  if (process.env.NODE_ENV === "test" || !env.autoRefreshEnabled) {
    return;
  }

  const state = getSchedulerState();

  if (state.started) {
    return;
  }

  state.started = true;

  const intervalMs = env.autoRefreshIntervalMinutes * 60 * 1000;
  const timer = setInterval(() => {
    void runScheduledRefresh();
  }, intervalMs);

  timer.unref?.();
  state.timer = timer;
}
