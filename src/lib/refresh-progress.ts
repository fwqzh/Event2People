export type RefreshProgressStage =
  | "queued"
  | "ingest"
  | "normalize"
  | "people"
  | "link"
  | "ai"
  | "validate"
  | "publish";

export type RefreshRunStatusValue = "RUNNING" | "SUCCESS" | "FAILED";

export type RefreshStatusSnapshot = {
  runId: string;
  status: RefreshRunStatusValue;
  progress: number;
  label: string;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
};

const REFRESH_PROGRESS_PREFIX = "progress::";

const STAGE_COPY: Record<RefreshProgressStage, { progress: number; label: string }> = {
  queued: { progress: 4, label: "准备刷新任务" },
  ingest: { progress: 12, label: "抓取 GitHub Trending 与 arXiv 候选" },
  normalize: { progress: 28, label: "整理项目、论文与基础结构" },
  people: { progress: 40, label: "补全 GitHub 负责人公开信息" },
  link: { progress: 62, label: "建立 repo-paper 与人物关系" },
  ai: { progress: 76, label: "生成 AI 中文文案" },
  validate: { progress: 90, label: "校验并写入新版本" },
  publish: { progress: 96, label: "发布新数据版本" },
};

function clampProgress(progress: number) {
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export function getRefreshStageCopy(stage: RefreshProgressStage) {
  return STAGE_COPY[stage];
}

export function encodeRefreshProgress(progress: number, label: string) {
  return `${REFRESH_PROGRESS_PREFIX}${clampProgress(progress)}|${label}`;
}

export function buildRefreshStageMessage(stage: RefreshProgressStage, detail?: string) {
  const base = STAGE_COPY[stage];
  return encodeRefreshProgress(base.progress, detail ? `${base.label} · ${detail}` : base.label);
}

export function buildRefreshRangeProgress(start: number, end: number, completed: number, total: number) {
  if (total <= 0) {
    return clampProgress(end);
  }

  const ratio = Math.max(0, Math.min(1, completed / total));
  return clampProgress(start + (end - start) * ratio);
}

export function decodeRefreshProgress(message: string | null | undefined, status: RefreshRunStatusValue) {
  if (message?.startsWith(REFRESH_PROGRESS_PREFIX)) {
    const payload = message.slice(REFRESH_PROGRESS_PREFIX.length);
    const separatorIndex = payload.indexOf("|");
    const progressText = separatorIndex >= 0 ? payload.slice(0, separatorIndex) : payload;
    const labelText = separatorIndex >= 0 ? payload.slice(separatorIndex + 1) : "";
    const progress = clampProgress(Number(progressText));

    return {
      progress,
      label: labelText || STAGE_COPY.queued.label,
      isStructured: true,
    };
  }

  if (status === "SUCCESS") {
    return {
      progress: 100,
      label: message || "刷新完成",
      isStructured: false,
    };
  }

  if (status === "FAILED") {
    return {
      progress: 100,
      label: message || "刷新失败",
      isStructured: false,
    };
  }

  return {
    progress: STAGE_COPY.queued.progress,
    label: message || STAGE_COPY.queued.label,
    isStructured: false,
  };
}

export function toRefreshStatusSnapshot(run: {
  id: string;
  status: RefreshRunStatusValue;
  message: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}) {
  const progress = decodeRefreshProgress(run.message, run.status);

  return {
    runId: run.id,
    status: run.status,
    progress: progress.progress,
    label: progress.label,
    message: run.message,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
  } satisfies RefreshStatusSnapshot;
}
