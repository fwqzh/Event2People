"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { SourceRefreshButton } from "@/components/source-refresh-button";
import { KICKSTARTER_MAX_VISIBLE_AGE_DAYS } from "@/lib/kickstarter-config";
import type { EventAnalysisView, EventDetailView, EventSummaryView } from "@/lib/types";

type EventSource = "github" | "kickstarter" | "arxiv";
type EventDetailStatus = "idle" | "loading" | "ready" | "error";

type EventBoardProps = {
  datasetVersionId: string;
  savedPersonStableIds: string[];
  githubEvents: EventSummaryView[];
  kickstarterEvents?: EventSummaryView[];
  arxivEvents: EventSummaryView[];
  visibleSources?: EventSource[];
  enableArxivFilters?: boolean;
};

const DEFAULT_VISIBLE_COUNT = 10;
const ARXIV_VISIBLE_LIMIT = 20;
const PREVIEW_PEOPLE_LIMIT = 3;
const EXPANDED_EVENT_STORAGE_KEY = "event-board-expanded-id";
const WARMUP_GITHUB_COUNT = 3;
const DETAIL_LOADING_DELAY_MS = 180;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const ARXIV_TIME_WINDOWS = [
  { value: "all", label: "全部" },
  { value: "7d", label: "7天" },
  { value: "30d", label: "30天" },
  { value: "90d", label: "90天" },
] as const;

type ArxivTimeWindow = (typeof ARXIV_TIME_WINDOWS)[number]["value"];
const KICKSTARTER_TIME_WINDOWS = [
  { value: "all", label: "全部" },
  { value: "7d", label: "7天" },
  { value: "14d", label: "14天" },
  { value: "30d", label: "30天" },
] as const;

type KickstarterTimeWindow = (typeof KICKSTARTER_TIME_WINDOWS)[number]["value"];
const ARXIV_CATEGORY_OPTIONS = [
  { value: "agent", label: "Agent" },
  { value: "world-model", label: "World Model" },
  { value: "embodied-intelligence", label: "Embodied Intelligence" },
  { value: "others", label: "Others" },
] as const;

type ArxivCategory = (typeof ARXIV_CATEGORY_OPTIONS)[number]["value"];

const SECTION_CONFIG: Record<
  EventSource,
  {
    title: string;
    kicker: string;
    status: string;
    description: string;
    emptyState: string;
    externalUrl?: string;
  }
> = {
  github: {
    title: "GitHub Trending",
    kicker: "Build / Execution",
    status: "GitHub Trending Daily",
    description: "基于 GitHub 官方 Trending Daily 页面动态解析，按 today stars 排序后展示 Top 10 项目事件。",
    emptyState: "当前没有匹配项目。",
    externalUrl: "https://github.com/trending?since=daily",
  },
  kickstarter: {
    title: "Kickstarter Signals",
    kicker: "Product / Demand",
    status: "Kickstarter Search",
    description:
      "直接抓取 Kickstarter 官方 Technology 分区的原站项目页；所有筛选都只会在最近 90 天项目池内生效，默认按筹款金额排序，若窗口内不足 10 个会自动补入 90 天内更早项目。",
    emptyState: "当前没有匹配 campaign。",
  },
  arxiv: {
    title: "ArXiv Trending",
    kicker: "Research / Entry",
    status: "arXiv + Semantic Scholar",
    description:
      "基于最近 90 天 arXiv 候选论文构建 50 篇活跃论文池，再结合 Semantic Scholar 引用、venue 信号和新鲜度排序；当前页支持严格筛选后默认展示前 20 篇。",
    emptyState: "当前没有匹配论文。",
  },
};

function getDefaultVisibleCount(source: EventSource) {
  return source === "arxiv" ? ARXIV_VISIBLE_LIMIT : DEFAULT_VISIBLE_COUNT;
}

function normalizeArxivTimeWindow(value: string | null | undefined): ArxivTimeWindow {
  return ARXIV_TIME_WINDOWS.some((windowOption) => windowOption.value === value) ? (value as ArxivTimeWindow) : "all";
}

function normalizeKickstarterTimeWindow(value: string | null | undefined): KickstarterTimeWindow {
  return KICKSTARTER_TIME_WINDOWS.some((windowOption) => windowOption.value === value)
    ? (value as KickstarterTimeWindow)
    : "all";
}

function normalizeArxivCategories(value: string | null | undefined) {
  const requested = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const requestedSet = new Set(requested);

  return ARXIV_CATEGORY_OPTIONS.map((option) => option.value).filter((value) => requestedSet.has(value));
}

function compactFilterValue(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function toEventTimestamp(event: EventSummaryView) {
  return new Date(event.timePrimary).getTime();
}

function extractKickstarterPledged(metrics: Array<{ label: string; value: string }>) {
  const metric = metrics.find((item) => item.label === "Pledged");

  if (!metric) {
    return -1;
  }

  const match = metric.value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : -1;
}

function extractKickstarterStartedAtTs(metrics: Array<{ label: string; value: string }>) {
  const metric = metrics.find((item) => item.label === "Started");

  if (!metric?.value || !/^\d{4}-\d{2}-\d{2}$/.test(metric.value)) {
    return -1;
  }

  const parsed = new Date(`${metric.value}T00:00:00.000Z`).getTime();
  return Number.isFinite(parsed) ? parsed : -1;
}

function compareKickstarterEventsByPledged(left: EventSummaryView, right: EventSummaryView) {
  const pledgedDelta = extractKickstarterPledged(right.metrics) - extractKickstarterPledged(left.metrics);

  if (pledgedDelta !== 0) {
    return pledgedDelta;
  }

  const startedDelta = extractKickstarterStartedAtTs(right.metrics) - extractKickstarterStartedAtTs(left.metrics);

  if (startedDelta !== 0) {
    return startedDelta;
  }

  const recencyDelta = right.timePrimary.getTime() - left.timePrimary.getTime();

  if (recencyDelta !== 0) {
    return recencyDelta;
  }

  return left.displayRank - right.displayRank;
}

function getKickstarterTimeWindowDays(value: KickstarterTimeWindow) {
  if (value === "all") {
    return null;
  }

  const parsed = Number(value.replace("d", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isKickstarterEventWithinWindow(event: EventSummaryView, maxAgeDays: number, nowTs: number) {
  const startedAtTs = extractKickstarterStartedAtTs(event.metrics);

  if (startedAtTs < 0) {
    return false;
  }

  return startedAtTs >= nowTs - maxAgeDays * DAY_IN_MS;
}

function buildArxivFilterHaystack(event: EventSummaryView) {
  return [
    event.cardTitle,
    event.eventTag,
    event.cardSummary,
    event.paperSummaryMetadata?.topic ?? "",
    ...(event.paperSummaryMetadata?.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function mapLegacyTopicToCategories(value: string | null | undefined): ArxivCategory[] {
  const normalized = compactFilterValue(value).toLowerCase();

  if (!normalized) {
    return [];
  }

  if (normalized.includes("world model") || normalized.includes("环境建模")) {
    return ["world-model"];
  }

  if (normalized.includes("agent")) {
    return ["agent"];
  }

  if (normalized.includes("embodied") || normalized.includes("机器人") || normalized.includes("具身")) {
    return ["embodied-intelligence"];
  }

  return ["others"];
}

function getArxivCategories(event: EventSummaryView): ArxivCategory[] {
  const haystack = buildArxivFilterHaystack(event);
  const categories: ArxivCategory[] = [];

  if (
    event.eventTag === "AI Agent" ||
    event.eventTag === "Coding Agent" ||
    /\bagent\b|\bbot\b|tool use|computer use|coding agent/i.test(haystack)
  ) {
    categories.push("agent");
  }

  if (
    event.eventTag === "World Model" ||
    /world model|simulation|simulator|sim-to-real|\bwm\b/i.test(haystack)
  ) {
    categories.push("world-model");
  }

  if (
    event.eventTag === "Embodied AI" ||
    event.eventTag === "Robotics" ||
    /embodied|robot|robotics|manipulation|humanoid|locomotion|navigation|具身|机器人/i.test(haystack)
  ) {
    categories.push("embodied-intelligence");
  }

  return categories.length > 0 ? categories : ["others"];
}

export function EventBoard({
  datasetVersionId,
  savedPersonStableIds,
  githubEvents,
  kickstarterEvents = [],
  arxivEvents,
  visibleSources,
  enableArxivFilters = false,
}: EventBoardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const detailRequestControllersRef = useRef<Map<string, AbortController>>(new Map());
  const analysisRequestControllersRef = useRef<Map<string, AbortController>>(new Map());
  const detailLoadingTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const warmedEventIdsRef = useRef<Set<string>>(new Set());
  const detailLoadTokenRef = useRef<Map<string, number>>(new Map());
  const analysisLoadTokenRef = useRef<Map<string, number>>(new Map());
  const [filterNowTs] = useState(() => Date.now());
  const searchParamsTime = searchParams.get("time");
  const searchParamsKickstarterTime = searchParams.get("kickstarterTime");
  const searchParamsTopic = searchParams.get("topic");
  const searchParamsCategories = searchParams.get("categories");
  const searchParamsEvent = searchParams.get("event");
  const [serverSavedPersonIds, setServerSavedPersonIds] = useState<string[]>(savedPersonStableIds);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isExpandedIdHydrated, setIsExpandedIdHydrated] = useState(false);
  const [visibleCounts, setVisibleCounts] = useState<Record<EventSource, number>>({
    github: DEFAULT_VISIBLE_COUNT,
    kickstarter: DEFAULT_VISIBLE_COUNT,
    arxiv: ARXIV_VISIBLE_LIMIT,
  });
  const [collapsedSections, setCollapsedSections] = useState<Record<EventSource, boolean>>({
    github: false,
    kickstarter: false,
    arxiv: false,
  });
  const [newlySavedPersonIds, setNewlySavedPersonIds] = useState<Set<string>>(() => new Set());
  const [removedPersonIds, setRemovedPersonIds] = useState<Set<string>>(() => new Set());
  const [detailsById, setDetailsById] = useState<Record<string, EventDetailView>>({});
  const [analysisById, setAnalysisById] = useState<Record<string, EventAnalysisView>>({});
  const [detailStatusById, setDetailStatusById] = useState<Record<string, EventDetailStatus>>({});
  const [detailErrorById, setDetailErrorById] = useState<Record<string, string>>({});
  const [detailLoadingVisibleById, setDetailLoadingVisibleById] = useState<Record<string, boolean>>({});
  const [analysisStatusById, setAnalysisStatusById] = useState<Record<string, EventDetailStatus>>({});
  const [analysisErrorById, setAnalysisErrorById] = useState<Record<string, string>>({});
  const [detailReloadTokenById, setDetailReloadTokenById] = useState<Record<string, number>>({});
  const [expandedPeopleByEventId, setExpandedPeopleByEventId] = useState<Record<string, boolean>>({});
  const [arxivTimeWindow, setArxivTimeWindow] = useState<ArxivTimeWindow>(() => normalizeArxivTimeWindow(searchParamsTime));
  const [kickstarterTimeWindow, setKickstarterTimeWindow] = useState<KickstarterTimeWindow>(
    () => normalizeKickstarterTimeWindow(searchParamsKickstarterTime),
  );
  const [arxivCategories, setArxivCategories] = useState<ArxivCategory[]>(
    () => normalizeArxivCategories(searchParamsCategories).length > 0
      ? normalizeArxivCategories(searchParamsCategories)
      : mapLegacyTopicToCategories(searchParamsTopic),
  );
  const [status, setStatus] = useState("");
  const sectionsToRender = useMemo(
    () => (visibleSources?.length ? [...new Set(visibleSources)] : (["github", "kickstarter", "arxiv"] as EventSource[])),
    [visibleSources],
  );

  const allEvents = useMemo(() => [...githubEvents, ...kickstarterEvents, ...arxivEvents], [arxivEvents, githubEvents, kickstarterEvents]);
  const selectedArxivCategories = useMemo(() => new Set(arxivCategories), [arxivCategories]);
  const enableKickstarterFilters = pathname === "/kickstarter";
  const kickstarterWindowDays = getKickstarterTimeWindowDays(kickstarterTimeWindow);
  const eligibleKickstarterEvents = useMemo(
    () =>
      kickstarterEvents.filter((event) =>
        isKickstarterEventWithinWindow(event, KICKSTARTER_MAX_VISIBLE_AGE_DAYS, filterNowTs),
      ),
    [filterNowTs, kickstarterEvents],
  );
  const sortedKickstarterEvents = useMemo(
    () => [...eligibleKickstarterEvents].sort(compareKickstarterEventsByPledged),
    [eligibleKickstarterEvents],
  );
  const kickstarterWindowMatches = useMemo(
    () =>
      kickstarterWindowDays === null
        ? sortedKickstarterEvents
        : sortedKickstarterEvents.filter((event) => isKickstarterEventWithinWindow(event, kickstarterWindowDays, filterNowTs)),
    [filterNowTs, kickstarterWindowDays, sortedKickstarterEvents],
  );
  const filteredKickstarterEvents = useMemo(() => {
    if (!enableKickstarterFilters) {
      return eligibleKickstarterEvents;
    }

    if (kickstarterTimeWindow === "all") {
      return sortedKickstarterEvents.slice(0, DEFAULT_VISIBLE_COUNT);
    }

    if (kickstarterWindowMatches.length >= DEFAULT_VISIBLE_COUNT) {
      return kickstarterWindowMatches.slice(0, DEFAULT_VISIBLE_COUNT);
    }

    const selectedIds = new Set(kickstarterWindowMatches.map((event) => event.stableId));
    const backfillEvents = sortedKickstarterEvents.filter((event) => !selectedIds.has(event.stableId));

    return [...kickstarterWindowMatches, ...backfillEvents].slice(0, DEFAULT_VISIBLE_COUNT);
  }, [
    eligibleKickstarterEvents,
    enableKickstarterFilters,
    kickstarterEvents,
    kickstarterTimeWindow,
    kickstarterWindowMatches,
    sortedKickstarterEvents,
  ]);
  const filteredArxivEvents = useMemo(() => {
    if (!enableArxivFilters) {
      return arxivEvents;
    }

    return arxivEvents.filter((event) => {
      const publishedAtTs = event.paperSummaryMetadata?.publishedAtTs || toEventTimestamp(event);

      if (arxivTimeWindow !== "all") {
        const maxAgeDays = Number(arxivTimeWindow.replace("d", ""));

        if (!Number.isFinite(maxAgeDays) || publishedAtTs < filterNowTs - maxAgeDays * DAY_IN_MS) {
          return false;
        }
      }

      if (selectedArxivCategories.size > 0) {
        const eventCategories = getArxivCategories(event);

        if (!eventCategories.some((category) => selectedArxivCategories.has(category))) {
          return false;
        }
      }

      return true;
    });
  }, [arxivEvents, arxivTimeWindow, enableArxivFilters, filterNowTs, selectedArxivCategories]);
  const hasActiveArxivFilters = enableArxivFilters && (arxivTimeWindow !== "all" || arxivCategories.length > 0);
  const renderedSectionEvents = useMemo(
    () =>
      sectionsToRender.flatMap((source) =>
        source === "github"
          ? githubEvents
          : source === "kickstarter"
            ? enableKickstarterFilters
              ? filteredKickstarterEvents
              : eligibleKickstarterEvents
            : enableArxivFilters
              ? filteredArxivEvents
              : arxivEvents,
      ),
    [
      arxivEvents,
      enableArxivFilters,
      enableKickstarterFilters,
      filteredArxivEvents,
      filteredKickstarterEvents,
      githubEvents,
      eligibleKickstarterEvents,
      sectionsToRender,
    ],
  );
  const savedPersonIds = useMemo(() => {
    const ids = new Set<string>(serverSavedPersonIds);
    newlySavedPersonIds.forEach((personStableId) => ids.add(personStableId));
    removedPersonIds.forEach((personStableId) => ids.delete(personStableId));
    return ids;
  }, [newlySavedPersonIds, removedPersonIds, serverSavedPersonIds]);

  const eventSourceById = useMemo(
    () => new Map(allEvents.map((event) => [event.stableId, event.sourceType])),
    [allEvents],
  );

  const clearDetailLoadingTimer = useEffectEvent((stableId: string) => {
    const timer = detailLoadingTimerRef.current.get(stableId);

    if (timer) {
      clearTimeout(timer);
      detailLoadingTimerRef.current.delete(stableId);
    }
  });

  const abortDetailRequest = useEffectEvent((stableId?: string) => {
    if (stableId) {
      const controller = detailRequestControllersRef.current.get(stableId);

      if (!controller) {
        return;
      }

      controller.abort();
      detailRequestControllersRef.current.delete(stableId);
      setDetailStatusById((current) =>
        current[stableId] === "loading" ? { ...current, [stableId]: "idle" } : current,
      );
      setDetailLoadingVisibleById((current) => ({ ...current, [stableId]: false }));
      return;
    }

    detailRequestControllersRef.current.forEach((controller, currentStableId) => {
      controller.abort();
      setDetailStatusById((current) =>
        current[currentStableId] === "loading" ? { ...current, [currentStableId]: "idle" } : current,
      );
      setDetailLoadingVisibleById((current) => ({ ...current, [currentStableId]: false }));
    });
    detailRequestControllersRef.current.clear();
  });

  const abortAnalysisRequest = useEffectEvent((stableId?: string) => {
    if (stableId) {
      const controller = analysisRequestControllersRef.current.get(stableId);

      if (!controller) {
        return;
      }

      controller.abort();
      analysisRequestControllersRef.current.delete(stableId);
      setAnalysisStatusById((current) =>
        current[stableId] === "loading" ? { ...current, [stableId]: "idle" } : current,
      );
      return;
    }

    analysisRequestControllersRef.current.forEach((controller, currentStableId) => {
      controller.abort();
      setAnalysisStatusById((current) =>
        current[currentStableId] === "loading" ? { ...current, [currentStableId]: "idle" } : current,
      );
    });
    analysisRequestControllersRef.current.clear();
  });

  async function syncSavedPeople() {
    try {
      const response = await fetch("/api/pipeline", {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        return;
      }

      setServerSavedPersonIds(Array.isArray(payload.savedPersonStableIds) ? payload.savedPersonStableIds : []);
    } catch {
      // Ignore sync failures and keep current UI state.
    }
  }

  const loadEventDetail = useEffectEvent(async (stableId: string, reloadToken = 0) => {
    if (detailsById[stableId] || detailStatusById[stableId] === "loading") {
      return;
    }

    if (detailStatusById[stableId] === "error" && detailLoadTokenRef.current.get(stableId) === reloadToken) {
      return;
    }

    const controller = new AbortController();
    detailLoadTokenRef.current.set(stableId, reloadToken);
    detailRequestControllersRef.current.set(stableId, controller);
    setDetailStatusById((current) => ({ ...current, [stableId]: "loading" }));
    setDetailLoadingVisibleById((current) => ({ ...current, [stableId]: false }));
    setDetailErrorById((current) => {
      const next = { ...current };
      delete next[stableId];
      return next;
    });
    clearDetailLoadingTimer(stableId);
    detailLoadingTimerRef.current.set(
      stableId,
      setTimeout(() => {
        setDetailLoadingVisibleById((current) => ({ ...current, [stableId]: true }));
      }, DETAIL_LOADING_DELAY_MS),
    );

    try {
      const response = await fetch(`/api/events/detail?stableId=${encodeURIComponent(stableId)}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "详情加载失败");
      }

      if (controller.signal.aborted) {
        return;
      }

      const analysis = analysisById[stableId];
      setDetailsById((current) => ({
        ...current,
        [stableId]: analysis ? { ...(payload.detail as EventDetailView), ...analysis } : (payload.detail as EventDetailView),
      }));
      setDetailStatusById((current) => ({ ...current, [stableId]: "ready" }));
      setDetailLoadingVisibleById((current) => ({ ...current, [stableId]: false }));
    } catch (error) {
      if (controller.signal.aborted) {
        setDetailStatusById((current) =>
          current[stableId] === "loading" ? { ...current, [stableId]: "idle" } : current,
        );
        setDetailLoadingVisibleById((current) => ({ ...current, [stableId]: false }));
        return;
      }

      setDetailStatusById((current) => ({ ...current, [stableId]: "error" }));
      setDetailLoadingVisibleById((current) => ({ ...current, [stableId]: false }));
      setDetailErrorById((current) => ({
        ...current,
        [stableId]: error instanceof Error ? error.message : "详情加载失败",
      }));
    } finally {
      clearDetailLoadingTimer(stableId);

      if (detailRequestControllersRef.current.get(stableId) === controller) {
        detailRequestControllersRef.current.delete(stableId);
      }
    }
  });

  const loadEventAnalysis = useEffectEvent(async (stableId: string, reloadToken = 0) => {
    const sourceType = eventSourceById.get(stableId);
    const existingAnalysis = analysisById[stableId];
    const existingDetail = detailsById[stableId];

    if (!sourceType || analysisStatusById[stableId] === "loading") {
      return;
    }

    if (
      (analysisStatusById[stableId] === "ready" || analysisStatusById[stableId] === "error") &&
      analysisLoadTokenRef.current.get(stableId) === reloadToken
    ) {
      return;
    }

    if (
      sourceType !== "arxiv" &&
      (existingAnalysis?.analysisSummary ||
        existingAnalysis?.analysisReferences?.length ||
        existingDetail?.analysisSummary ||
        existingDetail?.analysisReferences?.length)
    ) {
      return;
    }

    if (
      sourceType === "arxiv" &&
      (existingAnalysis?.paperExplanation || existingAnalysis?.analysisReferences?.length)
    ) {
      return;
    }

    const controller = new AbortController();
    analysisLoadTokenRef.current.set(stableId, reloadToken);
    analysisRequestControllersRef.current.set(stableId, controller);
    setAnalysisStatusById((current) => ({ ...current, [stableId]: "loading" }));
    setAnalysisErrorById((current) => {
      const next = { ...current };
      delete next[stableId];
      return next;
    });

    try {
      const response = await fetch(`/api/events/analysis?stableId=${encodeURIComponent(stableId)}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "详细解读加载失败");
      }

      if (controller.signal.aborted) {
        return;
      }

      const analysis = payload.analysis as EventAnalysisView;
      setAnalysisById((current) => ({ ...current, [stableId]: analysis }));
      setDetailsById((current) => {
        const existing = current[stableId];

        if (!existing) {
          return current;
        }

        return {
          ...current,
          [stableId]: {
            ...existing,
            ...analysis,
          },
        };
      });
      setAnalysisStatusById((current) => ({ ...current, [stableId]: "ready" }));
    } catch (error) {
      if (controller.signal.aborted) {
        setAnalysisStatusById((current) =>
          current[stableId] === "loading" ? { ...current, [stableId]: "idle" } : current,
        );
        return;
      }

      setAnalysisStatusById((current) => ({ ...current, [stableId]: "error" }));
      setAnalysisErrorById((current) => ({
        ...current,
        [stableId]: error instanceof Error ? error.message : "详细解读加载失败",
      }));
    } finally {
      if (analysisRequestControllersRef.current.get(stableId) === controller) {
        analysisRequestControllersRef.current.delete(stableId);
      }
    }
  });

  const warmEventCard = useEffectEvent((stableId: string) => {
    void loadEventDetail(stableId, 0);

    if (eventSourceById.get(stableId) === "github") {
      void loadEventAnalysis(stableId, 0);
    }
  });

  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setExpandedId(null);
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  useEffect(() => {
    setServerSavedPersonIds(savedPersonStableIds);
  }, [savedPersonStableIds]);

  useEffect(() => {
    if (!enableArxivFilters) {
      return;
    }

    const nextTimeWindow = normalizeArxivTimeWindow(searchParamsTime);
    const nextCategories = normalizeArxivCategories(searchParamsCategories).length > 0
      ? normalizeArxivCategories(searchParamsCategories)
      : mapLegacyTopicToCategories(searchParamsTopic);

    setArxivTimeWindow((current) => (current === nextTimeWindow ? current : nextTimeWindow));
    setArxivCategories((current) => (current.join(",") === nextCategories.join(",") ? current : nextCategories));
  }, [enableArxivFilters, searchParamsCategories, searchParamsTime, searchParamsTopic]);

  useEffect(() => {
    if (!enableKickstarterFilters) {
      return;
    }

    const nextTimeWindow = normalizeKickstarterTimeWindow(searchParamsKickstarterTime);
    setKickstarterTimeWindow((current) => (current === nextTimeWindow ? current : nextTimeWindow));
  }, [enableKickstarterFilters, searchParamsKickstarterTime]);

  useEffect(() => {
    if (!enableArxivFilters) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());

    if (arxivTimeWindow === "all") {
      params.delete("time");
    } else {
      params.set("time", arxivTimeWindow);
    }

    params.delete("topic");
    params.delete("q");

    if (arxivCategories.length === 0) {
      params.delete("categories");
    } else {
      params.set("categories", arxivCategories.join(","));
    }

    const nextQueryString = params.toString();
    const currentQueryString = searchParams.toString();

    if (nextQueryString === currentQueryString) {
      return;
    }

    startTransition(() => {
      router.replace(nextQueryString ? `${pathname}?${nextQueryString}` : pathname, { scroll: false });
    });
  }, [arxivCategories, arxivTimeWindow, enableArxivFilters, pathname, router, searchParams]);

  useEffect(() => {
    if (!enableKickstarterFilters) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());

    if (kickstarterTimeWindow === "all") {
      params.delete("kickstarterTime");
    } else {
      params.set("kickstarterTime", kickstarterTimeWindow);
    }

    const nextQueryString = params.toString();
    const currentQueryString = searchParams.toString();

    if (nextQueryString === currentQueryString) {
      return;
    }

    startTransition(() => {
      router.replace(nextQueryString ? `${pathname}?${nextQueryString}` : pathname, { scroll: false });
    });
  }, [enableKickstarterFilters, kickstarterTimeWindow, pathname, router, searchParams]);

  useEffect(() => {
    if (!enableArxivFilters) {
      return;
    }

    setVisibleCounts((current) =>
      current.arxiv === ARXIV_VISIBLE_LIMIT ? current : { ...current, arxiv: ARXIV_VISIBLE_LIMIT },
    );
  }, [arxivCategories, arxivTimeWindow, enableArxivFilters]);

  useEffect(() => {
    if (!enableKickstarterFilters) {
      return;
    }

    setVisibleCounts((current) =>
      current.kickstarter === DEFAULT_VISIBLE_COUNT ? current : { ...current, kickstarter: DEFAULT_VISIBLE_COUNT },
    );
  }, [enableKickstarterFilters, kickstarterTimeWindow]);

  useEffect(() => {
    const deepLinkedEventId = compactFilterValue(searchParamsEvent);

    if (!deepLinkedEventId) {
      return;
    }

    const source = eventSourceById.get(deepLinkedEventId);

    if (!source) {
      return;
    }

    const sourceEvents =
      source === "github"
        ? githubEvents
        : source === "kickstarter"
          ? enableKickstarterFilters
            ? filteredKickstarterEvents
            : eligibleKickstarterEvents
          : enableArxivFilters
            ? filteredArxivEvents
            : arxivEvents;
    const eventIndex = sourceEvents.findIndex((event) => event.stableId === deepLinkedEventId);

    if (eventIndex < 0) {
      return;
    }

    setVisibleCounts((current) => {
      const nextVisibleCount = Math.max(current[source], eventIndex + 1);

      return nextVisibleCount === current[source] ? current : { ...current, [source]: nextVisibleCount };
    });
    setCollapsedSections((current) => (current[source] ? { ...current, [source]: false } : current));
  }, [
    arxivEvents,
    enableArxivFilters,
    enableKickstarterFilters,
    eventSourceById,
    filteredArxivEvents,
    filteredKickstarterEvents,
    githubEvents,
    eligibleKickstarterEvents,
    searchParamsEvent,
    visibleCounts,
  ]);

  useEffect(() => {
    if (isExpandedIdHydrated) {
      return;
    }

    const deepLinkedEventId = compactFilterValue(searchParamsEvent);

    if (deepLinkedEventId && renderedSectionEvents.some((event) => event.stableId === deepLinkedEventId)) {
      setExpandedId(deepLinkedEventId);
      setIsExpandedIdHydrated(true);
      return;
    }

    const storedExpandedId = window.sessionStorage.getItem(EXPANDED_EVENT_STORAGE_KEY);

    if (storedExpandedId && renderedSectionEvents.some((event) => event.stableId === storedExpandedId)) {
      setExpandedId(storedExpandedId);
    } else if (storedExpandedId) {
      window.sessionStorage.removeItem(EXPANDED_EVENT_STORAGE_KEY);
    }

    setIsExpandedIdHydrated(true);
  }, [isExpandedIdHydrated, renderedSectionEvents, searchParamsEvent]);

  useEffect(() => {
    if (!isExpandedIdHydrated) {
      return;
    }

    if (expandedId && renderedSectionEvents.some((event) => event.stableId === expandedId)) {
      window.sessionStorage.setItem(EXPANDED_EVENT_STORAGE_KEY, expandedId);
      return;
    }

    window.sessionStorage.removeItem(EXPANDED_EVENT_STORAGE_KEY);
  }, [expandedId, isExpandedIdHydrated, renderedSectionEvents]);

  useEffect(() => {
    abortDetailRequest();
    abortAnalysisRequest();
    detailLoadingTimerRef.current.forEach((timer) => clearTimeout(timer));
    detailLoadingTimerRef.current.clear();
    setDetailsById({});
    setDetailStatusById({});
    setDetailErrorById({});
    setDetailLoadingVisibleById({});
    setAnalysisStatusById({});
    setAnalysisErrorById({});
    setDetailReloadTokenById({});
    setExpandedPeopleByEventId({});
    setRemovedPersonIds(new Set());
    setNewlySavedPersonIds(new Set());
    setAnalysisById({});
    setVisibleCounts({
      github: DEFAULT_VISIBLE_COUNT,
      kickstarter: DEFAULT_VISIBLE_COUNT,
      arxiv: ARXIV_VISIBLE_LIMIT,
    });
    warmedEventIdsRef.current.clear();
    detailLoadTokenRef.current.clear();
    analysisLoadTokenRef.current.clear();
    abortDetailRequest();
    abortAnalysisRequest();
  }, [datasetVersionId]);

  useEffect(() => {
    void syncSavedPeople();
  }, [datasetVersionId]);

  useEffect(() => {
    const onWindowFocus = () => {
      void syncSavedPeople();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncSavedPeople();
      }
    };

    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (expandedId && !allEvents.some((event) => event.stableId === expandedId)) {
      setExpandedId(null);
    }
  }, [allEvents, expandedId]);

  useEffect(() => {
    if (expandedId && !renderedSectionEvents.some((event) => event.stableId === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, renderedSectionEvents]);

  const expandedReloadToken = expandedId ? detailReloadTokenById[expandedId] ?? 0 : 0;

  useEffect(() => {
    if (!expandedId) {
      return;
    }

    void loadEventDetail(expandedId, expandedReloadToken);
  }, [datasetVersionId, expandedId, expandedReloadToken, eventSourceById]);

  useEffect(() => {
    if (!expandedId || !eventSourceById.get(expandedId)) {
      return;
    }

    void loadEventAnalysis(expandedId, expandedReloadToken);
  }, [expandedId, expandedReloadToken, eventSourceById]);

  useEffect(() => {
    if (collapsedSections.github) {
      return;
    }

    const warmIds = githubEvents
      .slice(0, Math.max(visibleCounts.github, WARMUP_GITHUB_COUNT))
      .map((event) => event.stableId)
      .filter((stableId) => !warmedEventIdsRef.current.has(stableId));

    if (warmIds.length === 0) {
      return;
    }

    let cancelled = false;
    const warmupHandles = warmIds.map((stableId, index) => {
      warmedEventIdsRef.current.add(stableId);

      return window.setTimeout(() => {
        if (cancelled) {
          return;
        }

        warmEventCard(stableId);
      }, 300 + index * 120);
    });

    return () => {
      cancelled = true;

      warmupHandles.forEach((handle) => clearTimeout(handle));
    };
  }, [collapsedSections.github, datasetVersionId, githubEvents, visibleCounts.github]);

  useEffect(
    () => () => {
      abortDetailRequest();
      abortAnalysisRequest();
      detailLoadingTimerRef.current.forEach((timer) => clearTimeout(timer));
      detailLoadingTimerRef.current.clear();
    },
    [],
  );

  async function saveToPipeline(personStableId: string, eventStableId: string) {
    setStatus("");

    const response = await fetch("/api/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personStableId, eventStableId }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "保存失败");
    }

    setNewlySavedPersonIds((current) => new Set([...current, personStableId]));
    setRemovedPersonIds((current) => {
      const next = new Set(current);
      next.delete(personStableId);
      return next;
    });
    void syncSavedPeople();
  }

  async function removeFromPipeline(personStableId: string) {
    setStatus("");

    const response = await fetch("/api/pipeline", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personStableId }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "取消失败");
    }

    setNewlySavedPersonIds((current) => {
      const next = new Set(current);
      next.delete(personStableId);
      return next;
    });
    setRemovedPersonIds((current) => new Set([...current, personStableId]));
    void syncSavedPeople();
  }

  function toggleExpanded(stableId: string) {
    setExpandedId((current) => (current === stableId ? null : stableId));
  }

  function togglePeopleExpanded(eventStableId: string) {
    setExpandedPeopleByEventId((current) => ({
      ...current,
      [eventStableId]: !current[eventStableId],
    }));
  }

  function hasActiveTextSelection(container: HTMLElement | null) {
    if (!container || typeof window === "undefined") {
      return false;
    }

    const selection = window.getSelection();

    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return false;
    }

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;

    return Boolean(
      (anchorNode && container.contains(anchorNode)) ||
        (focusNode && container.contains(focusNode)),
    );
  }

  function shouldIgnoreCardToggle(target: EventTarget | null) {
    return target instanceof HTMLElement && Boolean(target.closest("a, button, summary, details"));
  }

  function handleCardClick(
    stableId: string,
    isExpanded: boolean,
    target: EventTarget | null,
    currentTarget: HTMLElement | null,
  ) {
    if (shouldIgnoreCardToggle(target)) {
      return;
    }

    if (isExpanded && hasActiveTextSelection(currentTarget)) {
      return;
    }

    toggleExpanded(stableId);
  }

  function getPersonMeta(person: EventDetailView["people"][number], sourceType: EventSource) {
    const fallbackInstitution = person.organizationNamesRaw?.[0] ?? person.schoolNamesRaw?.[0] ?? person.labNamesRaw?.[0] ?? "";

    if (sourceType !== "arxiv") {
      return [fallbackInstitution].filter(Boolean);
    }

    const paperInstitutions = new Set((person.paperAuthorProfile?.institutions ?? []).filter(Boolean));

    return [fallbackInstitution].filter((institution) => institution && !paperInstitutions.has(institution)).slice(0, 1);
  }

  function getEffectiveContributionCount(person: EventDetailView["people"][number]) {
    if (person.contributionCount > 0) {
      return person.contributionCount;
    }

    const matchedCount = person.evidenceSummaryZh.match(/(\d+)\s*commits/i)?.[1];
    return matchedCount ? Number(matchedCount) : 0;
  }

  function getPersonSubline(person: EventDetailView["people"][number], sourceType: EventSource) {
    if (sourceType === "github") {
      const contributionCount = getEffectiveContributionCount(person);
      return contributionCount > 0 ? `${contributionCount} commits` : "commit 数未知";
    }

    return person.identitySummaryZh;
  }

  function shouldShowPersonEvidence(person: EventDetailView["people"][number], sourceType: EventSource) {
    const evidence = person.evidenceSummaryZh.trim();

    if (!evidence) {
      return false;
    }

    if (sourceType === "arxiv" && /^(是当前论文作者|论文作者)$/u.test(evidence)) {
      return false;
    }

    return true;
  }

  function getPaperProfileInstitutionText(person: EventDetailView["people"][number]) {
    return [...new Set((person.paperAuthorProfile?.institutions ?? []).filter(Boolean))].join(" / ");
  }

  function getPaperProfileEmails(person: EventDetailView["people"][number]) {
    return [...new Set((person.paperAuthorProfile?.emails ?? []).map((email) => email.trim()).filter(Boolean))];
  }

  function getReadablePersonLinks(person: EventDetailView["people"][number], sourceType: EventSource) {
    const paperEmails = new Set(sourceType === "arxiv" ? getPaperProfileEmails(person) : []);

    return person.links.flatMap((link) => {
      if (link.label === "Email") {
        const email = link.url.replace(/^mailto:/i, "");

        if (paperEmails.has(email)) {
          return [];
        }

        return {
          label: "邮箱",
          value: email,
          href: link.url,
        };
      }

      if (link.label === "GitHub") {
        return {
          label: "GitHub链接",
          value: link.url,
          href: link.url,
        };
      }

      if (link.label === "Homepage") {
        return {
          label: "个人主页",
          value: link.url,
          href: link.url,
        };
      }

      return {
        label: link.label,
        value: link.url,
        href: link.url,
      };
    });
  }

  function getPrimarySourceUrl(event: EventSummaryView) {
    return event.sourceLinks[0]?.url ?? null;
  }

  function getPrimarySourceLabel(event: EventSummaryView) {
    if (event.sourceType === "arxiv") {
      return "ArXiv 网页";
    }

    if (event.sourceType === "kickstarter") {
      return "原站链接";
    }

    return "链接";
  }

  function getArxivPaperUrl(event: EventSummaryView) {
    return (
      event.sourceLinks.find((sourceLink) => sourceLink.label === "Paper" && /arxiv\.org\/abs\//i.test(sourceLink.url))?.url ??
      event.sourceLinks.find((sourceLink) => sourceLink.label === "Paper")?.url ??
      null
    );
  }

  function getSecondarySourceLinks(event: EventSummaryView) {
    const primarySourceUrl = getPrimarySourceUrl(event);
    const seen = new Set<string>();

    return event.sourceLinks.filter((sourceLink) => {
      if (
        sourceLink.label === "Semantic Scholar" ||
        sourceLink.url === primarySourceUrl ||
        seen.has(sourceLink.url)
      ) {
        return false;
      }

      seen.add(sourceLink.url);
      return true;
    });
  }

  function shouldShowExpandedIntro(detail: EventDetailView | undefined, cardSummary: string) {
    if (!detail?.introSummary) {
      return false;
    }

    return detail.introSummary !== cardSummary && detail.introSummary !== detail.detailSummary;
  }

  function getAnalysisParagraphs(detail: Pick<EventAnalysisView, "analysisSummary"> | undefined) {
    if (!detail?.analysisSummary) {
      return [];
    }

    return detail.analysisSummary
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  }

  function toggleSectionCollapse(source: EventSource) {
    setCollapsedSections((current) => ({
      ...current,
      [source]: !current[source],
    }));
  }

  function toggleVisibleCount(source: EventSource, totalCount: number) {
    setVisibleCounts((current) => {
      const visibleCount = current[source];
      const defaultVisibleCount = getDefaultVisibleCount(source);

      return {
        ...current,
        [source]:
          visibleCount >= totalCount
            ? defaultVisibleCount
            : Math.min(visibleCount + defaultVisibleCount, totalCount),
      };
    });
  }

  function clearArxivFilters() {
    setArxivTimeWindow("all");
    setArxivCategories([]);
  }

  function toggleKickstarterTimeWindow(nextTimeWindow: KickstarterTimeWindow, checked: boolean) {
    setKickstarterTimeWindow(checked ? nextTimeWindow : "all");
  }

  function toggleArxivTimeWindow(nextTimeWindow: ArxivTimeWindow, checked: boolean) {
    setArxivTimeWindow(checked ? nextTimeWindow : "all");
  }

  function toggleArxivCategory(category: ArxivCategory, checked: boolean) {
    setArxivCategories((current) =>
      checked
        ? normalizeArxivCategories([...current, category].join(","))
        : current.filter((item) => item !== category),
    );
  }

  function renderSection(source: EventSource, events: EventSummaryView[]) {
    const config = SECTION_CONFIG[source];
    const isCollapsed = collapsedSections[source];
    const displayedEvents =
      source === "kickstarter" && enableKickstarterFilters
        ? filteredKickstarterEvents
        : source === "arxiv" && enableArxivFilters
          ? filteredArxivEvents
          : events;
    const totalDisplayedCount = displayedEvents.length;
    const sectionEventCount = source === "kickstarter" && enableKickstarterFilters ? totalDisplayedCount : events.length;
    const visibleCount = visibleCounts[source];
    const defaultVisibleCount = getDefaultVisibleCount(source);
    const visibleEvents =
      source === "kickstarter" && enableKickstarterFilters
        ? displayedEvents
        : displayedEvents.slice(0, visibleCount);
    const sectionPersonIds = new Set(events.flatMap((event) => event.personStableIds));
    const sectionPeopleCount = sectionPersonIds.size;
    const savedInSectionCount = [...sectionPersonIds].filter((personStableId) => savedPersonIds.has(personStableId)).length;
    const showKickstarterFilters = source === "kickstarter" && enableKickstarterFilters;
    const showArxivFilters = source === "arxiv" && enableArxivFilters;
    const showArxivUnderflowNotice = showArxivFilters && hasActiveArxivFilters && totalDisplayedCount < ARXIV_VISIBLE_LIMIT;
    const showKickstarterBackfillNotice =
      showKickstarterFilters &&
      kickstarterTimeWindow !== "all" &&
      kickstarterWindowMatches.length < DEFAULT_VISIBLE_COUNT &&
      eligibleKickstarterEvents.length > kickstarterWindowMatches.length &&
      totalDisplayedCount > kickstarterWindowMatches.length;

    return (
      <section className="board-section" key={source} id={`section-${source}`}>
        <div className="board-section__header">
          <div className="board-section__headline">
            <div className="board-section__eyebrow-row">
              <span className="section-kicker">{config.kicker}</span>
              <span className="status-chip">{config.status}</span>
            </div>
            <div className="board-section__title-row">
              <button
                type="button"
                className={`board-section__toggle ${isCollapsed ? "is-collapsed" : "is-expanded"}`}
                onClick={() => toggleSectionCollapse(source)}
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? `展开 ${config.title} 板块` : `收起 ${config.title} 板块`}
              >
                <span className="board-section__toggle-icon" aria-hidden="true" />
              </button>
              <h2>
                {config.externalUrl ? (
                  <Link href={config.externalUrl} className="board-section__title-link" target="_blank" rel="noreferrer">
                    {config.title}
                  </Link>
                ) : (
                  config.title
                )}{" "}
                <span>· {sectionEventCount} 条近期事件</span>
              </h2>
            </div>
            <p className="board-section__copy">{config.description}</p>
          </div>

          <div className="board-section__aside">
            <div className="board-section__summary">
              <article className="section-stat">
                <span>Events</span>
                <strong>{sectionEventCount}</strong>
              </article>
              <article className="section-stat">
                <span>People</span>
                <strong>{sectionPeopleCount}</strong>
              </article>
              <article className="section-stat">
                <span>Saved</span>
                <strong>{savedInSectionCount}</strong>
              </article>
            </div>

            <div className="board-section__actions">
              <SourceRefreshButton source={source} />
              {!isCollapsed && !showArxivFilters && !showKickstarterFilters && totalDisplayedCount > defaultVisibleCount ? (
                <button type="button" className="ghost-button" onClick={() => toggleVisibleCount(source, totalDisplayedCount)}>
                  {visibleCount >= totalDisplayedCount ? "收起列表" : showArxivFilters ? "查看更多结果" : "查看更多"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {showKickstarterFilters ? (
          <div className="arxiv-filter-shell">
            <div className="arxiv-filter-group" role="group" aria-label="Kickstarter 开始时间筛选">
              <span className="arxiv-filter-group__label">开始时间</span>
              <div className="arxiv-filter-group__checks">
                {KICKSTARTER_TIME_WINDOWS.map((windowOption) => (
                  <label
                    key={windowOption.value}
                    className={`filter-checkbox ${kickstarterTimeWindow === windowOption.value ? "is-active" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={kickstarterTimeWindow === windowOption.value}
                      onChange={(changeEvent) => toggleKickstarterTimeWindow(windowOption.value, changeEvent.target.checked)}
                    />
                    <span className="filter-checkbox__control" aria-hidden="true" />
                    <span className="filter-checkbox__label">{windowOption.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="arxiv-filter-toolbar">
              <p className="arxiv-filter-summary">
                {kickstarterTimeWindow === "all"
                  ? `当前展示 ${totalDisplayedCount} / ${eligibleKickstarterEvents.length} 个项目`
                  : `${kickstarterWindowMatches.length} / ${eligibleKickstarterEvents.length} 个项目落在时间窗内，当前展示 ${totalDisplayedCount} 个`}
              </p>
            </div>

            {showKickstarterBackfillNotice ? (
              <p className="arxiv-filter-note">
                当前时间窗内只有 {kickstarterWindowMatches.length} 个项目，已按筹款金额补入 90 天内更早项目，保证展示 10 张卡片。
              </p>
            ) : null}
          </div>
        ) : showArxivFilters ? (
          <div className="arxiv-filter-shell">
            <div className="arxiv-filter-group" role="group" aria-label="论文时间筛选">
              <span className="arxiv-filter-group__label">时间</span>
              <div className="arxiv-filter-group__checks">
                {ARXIV_TIME_WINDOWS.map((windowOption) => (
                  <label
                    key={windowOption.value}
                    className={`filter-checkbox ${arxivTimeWindow === windowOption.value ? "is-active" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={arxivTimeWindow === windowOption.value}
                      onChange={(changeEvent) => toggleArxivTimeWindow(windowOption.value, changeEvent.target.checked)}
                    />
                    <span className="filter-checkbox__control" aria-hidden="true" />
                    <span className="filter-checkbox__label">{windowOption.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="arxiv-filter-group" role="group" aria-label="论文类目筛选">
              <span className="arxiv-filter-group__label">类目</span>
              <div className="arxiv-filter-group__checks">
                {ARXIV_CATEGORY_OPTIONS.map((categoryOption) => (
                  <label
                    key={categoryOption.value}
                    className={`filter-checkbox ${selectedArxivCategories.has(categoryOption.value) ? "is-active" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedArxivCategories.has(categoryOption.value)}
                      onChange={(changeEvent) => toggleArxivCategory(categoryOption.value, changeEvent.target.checked)}
                    />
                    <span className="filter-checkbox__control" aria-hidden="true" />
                    <span className="filter-checkbox__label">{categoryOption.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="arxiv-filter-toolbar">
              <p className="arxiv-filter-summary">
                {totalDisplayedCount} / {arxivEvents.length} 篇匹配
              </p>
              <button type="button" className="ghost-button" onClick={clearArxivFilters}>
                清空筛选
              </button>
            </div>

            {showArxivUnderflowNotice ? (
              <p className="arxiv-filter-note">
                当前仅找到 {totalDisplayedCount} 篇符合条件的论文。可尝试放宽时间窗，或清空类目筛选。
              </p>
            ) : null}
          </div>
        ) : null}

        {!isCollapsed ? (
          visibleEvents.length > 0 ? (
            <div className="event-list">
              {visibleEvents.map((event) => {
              const isExpanded = expandedId === event.stableId;
              const isDimmed = expandedId !== null && expandedId !== event.stableId;
              const detail = detailsById[event.stableId];
              const analysis = analysisById[event.stableId] ?? detail;
              const detailStatus = detailStatusById[event.stableId] ?? "idle";
              const detailError = detailErrorById[event.stableId];
              const analysisStatus = analysisStatusById[event.stableId] ?? "idle";
              const analysisError = analysisErrorById[event.stableId];
              const isDetailLoading = isExpanded && detailStatus === "loading";
              const showExpandedIntro = shouldShowExpandedIntro(detail, event.cardSummary);
              const primarySourceUrl = getPrimarySourceUrl(event);
              const arxivPaperUrl = event.sourceType === "arxiv" ? getArxivPaperUrl(event) : null;
              const analysisReferenceUrls = new Set((analysis?.analysisReferences ?? []).map((reference) => reference.url));
              const secondarySourceLinks = getSecondarySourceLinks(event).filter(
                (sourceLink) => !analysisReferenceUrls.has(sourceLink.url),
              );
              const showExpandedIntroInCard = isExpanded && event.sourceType === "github" && showExpandedIntro;
              const showExpandedIntroInDetail = event.sourceType !== "github" && showExpandedIntro;
              const showPrimarySourceLinkInCard =
                Boolean(primarySourceUrl) && ((isExpanded && event.sourceType === "github") || event.sourceType === "kickstarter");
              const showArxivPaperLinkInCard = isExpanded && event.sourceType === "arxiv" && Boolean(arxivPaperUrl);
              const highlightCopy = showExpandedIntroInCard ? detail!.introSummary : event.cardSummary;
              const showPaperExplanation = event.sourceType === "arxiv" && Boolean(detail?.paperExplanation);
              const showPaperMetadata = event.sourceType === "arxiv" && Boolean(detail?.paperMetadata);
              const showDetailSummaryInPanel =
                event.sourceType !== "github" && Boolean(detail) && !(event.sourceType === "arxiv" && showPaperExplanation);
              const showEventLens = Boolean(detail) && detail.detailSummary !== event.eventHighlightZh;
              const analysisParagraphs = getAnalysisParagraphs(analysis);
              const showBlockingDetailLoading = isDetailLoading && !detail && detailLoadingVisibleById[event.stableId];
              const showProjectAnalysisLoading =
                isExpanded &&
                event.sourceType !== "arxiv" &&
                Boolean(detail) &&
                analysisParagraphs.length === 0 &&
                analysisStatus === "loading";
              const showProjectAnalysisError =
                isExpanded &&
                event.sourceType !== "arxiv" &&
                Boolean(detail) &&
                analysisParagraphs.length === 0 &&
                analysisStatus === "error";
              const showArxivAnalysisLoading =
                isExpanded &&
                event.sourceType === "arxiv" &&
                Boolean(detail) &&
                (detail.analysisReferences?.length ?? 0) === 0 &&
                analysisStatus === "loading";
              const showArxivAnalysisError =
                isExpanded &&
                event.sourceType === "arxiv" &&
                Boolean(detail) &&
                (detail.analysisReferences?.length ?? 0) === 0 &&
                analysisStatus === "error";
              const showArxivAnalysisFallbackNote =
                isExpanded &&
                event.sourceType === "arxiv" &&
                Boolean(detail) &&
                (detail.analysisReferences?.length ?? 0) === 0 &&
                analysisStatus === "ready";
              const primaryDetailPanelTitle = event.sourceType === "github" ? "项目信号" : detail?.sourceSummaryLabel ?? "论文概览";
              const primaryDetailPanelClassName = event.sourceType === "arxiv" ? "detail-panel detail-panel--wide" : "detail-panel";
              const people =
                detail?.people
                  ?.slice()
                  .sort((left, right) => {
                    if (event.sourceType === "github") {
                      const contributionDelta = getEffectiveContributionCount(right) - getEffectiveContributionCount(left);

                      if (contributionDelta !== 0) {
                        return contributionDelta;
                      }
                    }

                    return left.name.localeCompare(right.name);
                  }) ?? [];
              const peopleExpanded = expandedPeopleByEventId[event.stableId] ?? false;
              const visiblePeople = peopleExpanded ? people : people.slice(0, 4);
              const hasMorePeople = people.length > 4;

              return (
                <div key={event.stableId} className={`event-stack ${isExpanded ? "is-expanded" : ""}`}>
                  <article
                    className={`event-card ${isExpanded ? "is-expanded" : ""} ${isDimmed ? "is-dimmed" : ""}`}
                    onClick={(clickEvent) =>
                      handleCardClick(
                        event.stableId,
                        isExpanded,
                        clickEvent.target,
                        clickEvent.currentTarget,
                      )
                    }
                    onKeyDown={(keyboardEvent) => {
                      if (keyboardEvent.target !== keyboardEvent.currentTarget) {
                        return;
                      }

                      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                        keyboardEvent.preventDefault();
                        toggleExpanded(event.stableId);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                  >
                    <span className="event-card__rank">#{event.displayRank}</span>
                    <div className="event-card__header">
                      <div className="event-card__tag-row">
                        <div className="event-card__tag">{event.eventTag}</div>
                        {event.isNew ? (
                          <span className="event-card__new-pill" aria-label="新出现的事件">
                            NEW
                          </span>
                        ) : null}
                        <span className="data-pill">{event.timeAgo}</span>
                      </div>
                    </div>

                    <div className="event-card__body">
                      {event.sourceType === "kickstarter" && event.previewImageUrl ? (
                        <div className="event-card__media">
                          <img
                            className="event-card__media-image"
                            src={event.previewImageUrl}
                            alt={`${event.cardTitle} 产品预览`}
                            loading="lazy"
                            decoding="async"
                          />
                        </div>
                      ) : null}
                        <div className="event-card__title-row">
                          <button
                          type="button"
                          className={`event-card__toggle ${isExpanded ? "is-expanded" : "is-collapsed"}`}
                          onClick={() => toggleExpanded(event.stableId)}
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? `收起 ${event.cardTitle}` : `展开 ${event.cardTitle}`}
                        >
                          <span className="event-card__toggle-icon" aria-hidden="true" />
                        </button>
                        <h3>{event.cardTitle}</h3>
                      </div>
                      <p className="event-card__highlight" suppressHydrationWarning>
                        {highlightCopy}
                      </p>
                      {showArxivPaperLinkInCard && arxivPaperUrl ? (
                        <div className="event-card__primary-link-row">
                          <span className="event-card__primary-link-label">ArXiv 网页：</span>
                          <Link
                            className="event-card__primary-link"
                            href={arxivPaperUrl}
                            onClick={(clickEvent) => clickEvent.stopPropagation()}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {arxivPaperUrl}
                          </Link>
                        </div>
                      ) : null}
                      {showPrimarySourceLinkInCard && primarySourceUrl ? (
                        <div className="event-card__primary-link-row">
                          <span className="event-card__primary-link-label">{getPrimarySourceLabel(event)}：</span>
                          <Link
                            className="event-card__primary-link"
                            href={primarySourceUrl}
                            onClick={(clickEvent) => clickEvent.stopPropagation()}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {primarySourceUrl}
                          </Link>
                        </div>
                      ) : null}
                    </div>

                    <div className="event-card__foot">
                      <div className="metric-row">
                        {event.metrics.map((metric) => (
                          <span key={`${event.stableId}-${metric.label}`} className="metric-pill">
                            <strong>{metric.value}</strong>
                            <em>{metric.label}</em>
                          </span>
                        ))}
                      </div>

                      <div className="people-preview">
                        <span className="people-preview__label">关联人物</span>
                        {event.previewPeople.length > 0 ? (
                          <>
                            {event.previewPeople.map((person) =>
                              person.primaryLinkUrl ? (
                                <Link
                                  key={person.stableId}
                                  href={person.primaryLinkUrl}
                                  onClick={(clickEvent) => clickEvent.stopPropagation()}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {person.name}
                                </Link>
                              ) : (
                                <span key={person.stableId}>{person.name}</span>
                              ),
                            )}
                            {event.peopleCount > PREVIEW_PEOPLE_LIMIT ? (
                              <span>+{event.peopleCount - PREVIEW_PEOPLE_LIMIT} more</span>
                            ) : null}
                          </>
                        ) : (
                          <span className="people-preview__placeholder">暂未识别到明确关联人物</span>
                        )}
                      </div>
                    </div>

                    <div className="event-card__expand-shell" aria-hidden={!isExpanded}>
                      <div className="event-card__expand-shell-inner">
                        <div className="event-card__expanded">
                          <div className="event-detail-card__top">
                            <div className="event-detail-card__intro">
                              <div className="event-detail-card__meta">
                                <span className="section-kicker">Event Detail</span>
                                <div className="event-detail-card__meta-pills">
                                  <span className="status-chip">{event.peopleCount} 人物</span>
                                  <span className="data-pill">{event.sourceLinks.length} 来源</span>
                                </div>
                              </div>
                              {showExpandedIntroInDetail ? <p suppressHydrationWarning>{detail!.introSummary}</p> : null}
                            </div>
                          </div>

                          {showBlockingDetailLoading ? (
                            <div className="detail-loading-panel" aria-live="polite">
                              <span className="detail-loading-panel__spinner" aria-hidden="true" />
                              <div>
                                <strong>正在打开当前卡片详情</strong>
                                <p>人物和来源会先展开，长文解读会在后台继续补齐。</p>
                              </div>
                            </div>
                          ) : null}

                          {!detail && detailStatus === "error" ? (
                            <div className="detail-loading-panel detail-loading-panel--error" aria-live="polite">
                              <div>
                                <strong>{detailError ?? "详情加载失败"}</strong>
                                <p>当前列表仍可继续浏览，点击下方按钮可重试这张卡片。</p>
                              </div>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() =>
                                  setDetailReloadTokenById((current) => ({
                                    ...current,
                                    [event.stableId]: (current[event.stableId] ?? 0) + 1,
                                  }))
                                }
                              >
                                重试详情
                              </button>
                            </div>
                          ) : null}

                          {detail ? (
                            <div className="event-detail-grid">
                              <section className={primaryDetailPanelClassName}>
                                <h5>{primaryDetailPanelTitle}</h5>
                                {showDetailSummaryInPanel ? <p suppressHydrationWarning>{detail.detailSummary}</p> : null}
                                {showPaperExplanation ? (
                                  <div className="paper-explanation-list">
                                    <article className="paper-explanation-item">
                                      <strong>论文解决了什么问题</strong>
                                      <p>{detail.paperExplanation!.problem}</p>
                                    </article>
                                    <article className="paper-explanation-item">
                                      <strong>用了什么方法</strong>
                                      <p>{detail.paperExplanation!.method}</p>
                                    </article>
                                    <article className="paper-explanation-item">
                                      <strong>核心贡献是什么</strong>
                                      <p>{detail.paperExplanation!.contribution}</p>
                                    </article>
                                  </div>
                                ) : null}
                                {event.sourceType === "arxiv" && analysisParagraphs.length > 0 ? (
                                  <div className="detail-analysis-copy">
                                    <h5>详细解读</h5>
                                    {analysisParagraphs.map((paragraph, index) => (
                                      <p key={`${event.stableId}-analysis-${index}`}>{paragraph}</p>
                                    ))}
                                    {detail.analysisReferences && detail.analysisReferences.length > 0 ? (
                                      <div className="detail-analysis-references">
                                        <h6>引用来源</h6>
                                        <div className="link-list link-list--stacked">
                                          {detail.analysisReferences.map((reference, index) => (
                                            <p
                                              key={`${event.stableId}-analysis-reference-${reference.url}`}
                                              className="link-list__text"
                                            >
                                              <span>[{index + 1}] {reference.label}：</span>
                                              <Link href={reference.url} target="_blank" rel="noreferrer">
                                                {reference.title}
                                              </Link>
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                                {showArxivAnalysisLoading ? (
                                  <div className="detail-analysis-copy" aria-live="polite">
                                    <h5>详细解读</h5>
                                    <div className="detail-panel__loading-row">
                                      <span
                                        className="detail-loading-panel__spinner detail-loading-panel__spinner--inline"
                                        aria-hidden="true"
                                      />
                                      <p className="detail-panel__subcopy">
                                        正在补充中文互联网来源和 AI 解读，不影响你先看论文基础信息。
                                      </p>
                                    </div>
                                  </div>
                                ) : null}
                                {showArxivAnalysisError ? (
                                  <div className="detail-analysis-copy">
                                    <h5>详细解读</h5>
                                    <p className="detail-panel__subcopy">{analysisError ?? "中文互联网来源暂时加载失败"}</p>
                                    <button
                                      type="button"
                                      className="text-action-button"
                                      onClick={(clickEvent) => {
                                        clickEvent.stopPropagation();
                                        setDetailReloadTokenById((current) => ({
                                          ...current,
                                          [event.stableId]: (current[event.stableId] ?? 0) + 1,
                                        }));
                                      }}
                                    >
                                      重试解读
                                    </button>
                                  </div>
                                ) : null}
                                {showArxivAnalysisFallbackNote ? (
                                  <div className="detail-analysis-copy">
                                    <h5>详细解读</h5>
                                    <p className="detail-panel__subcopy">
                                      暂未抓到稳定的中文互联网来源，当前解读先基于论文标题和摘要生成。
                                    </p>
                                  </div>
                                ) : null}
                                {showPaperMetadata ? (
                                  <div className="paper-metadata-grid">
                                    <article className="paper-metadata-item">
                                      <strong>论文发表时间</strong>
                                      <p>{detail.paperMetadata!.publishedAtLabel || "暂未识别"}</p>
                                    </article>
                                    <article className="paper-metadata-item">
                                      <strong>作者名单</strong>
                                      <p>
                                        {detail.paperMetadata!.authors.length > 0
                                          ? detail.paperMetadata!.authors.join(" / ")
                                          : "暂未识别到作者名单"}
                                      </p>
                                    </article>
                                    <article className="paper-metadata-item">
                                      <strong>作者邮箱</strong>
                                      <p>
                                        {detail.paperMetadata!.authorEmails.length > 0
                                          ? detail.paperMetadata!.authorEmails.join(" / ")
                                          : "暂未识别到作者邮箱"}
                                      </p>
                                    </article>
                                    <article className="paper-metadata-item">
                                      <strong>主要作者单位</strong>
                                      <p>
                                        {detail.paperMetadata!.leadAuthorAffiliations.length > 0
                                          ? detail.paperMetadata!.leadAuthorAffiliations
                                              .map(
                                                (item) =>
                                                  `${item.author}：${item.institutions.join(" / ")}`,
                                              )
                                              .join("；")
                                          : detail.paperMetadata!.institutions.length > 0
                                            ? detail.paperMetadata!.institutions.join(" / ")
                                            : "暂未识别到主要作者单位"}
                                      </p>
                                    </article>
                                    <article className="paper-metadata-item">
                                      <strong>论文主题</strong>
                                      <p>{detail.paperMetadata!.topic || "暂未识别"}</p>
                                    </article>
                                    <article className="paper-metadata-item">
                                      <strong>论文关键词</strong>
                                      <p>
                                        {detail.paperMetadata!.keywords.length > 0
                                          ? detail.paperMetadata!.keywords.join(" / ")
                                          : "暂未提取关键词"}
                                      </p>
                                    </article>
                                  </div>
                                ) : null}
                                {showEventLens ? <p className="detail-panel__subcopy">事件判断：{event.eventHighlightZh}</p> : null}
                                <div className="metric-column">
                                  {event.metrics.map((metric) => (
                                    <div key={`${event.stableId}-detail-${metric.label}`} className="metric-line">
                                      <span>{metric.label}</span>
                                      <strong>{metric.value}</strong>
                                    </div>
                                  ))}
                                </div>
                              </section>

                              {event.sourceType !== "arxiv" && analysisParagraphs.length > 0 ? (
                                <section className="detail-panel detail-panel--wide detail-panel--analysis">
                                  <h5>详细解读</h5>
                                  <div className="detail-analysis-copy">
                                    {analysisParagraphs.map((paragraph, index) => (
                                      <p key={`${event.stableId}-analysis-${index}`}>{paragraph}</p>
                                    ))}
                                  </div>
                                  {detail.analysisReferences && detail.analysisReferences.length > 0 ? (
                                    <div className="detail-analysis-references">
                                      <h6>引用来源</h6>
                                      <div className="link-list link-list--stacked">
                                        {detail.analysisReferences.map((reference, index) => (
                                          <p
                                            key={`${event.stableId}-analysis-reference-${reference.url}`}
                                            className="link-list__text"
                                          >
                                            <span>[{index + 1}] {reference.label}：</span>
                                            <Link href={reference.url} target="_blank" rel="noreferrer">
                                              {reference.title}
                                            </Link>
                                          </p>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </section>
                              ) : null}

                              {showProjectAnalysisLoading ? (
                                <section className="detail-panel detail-panel--wide detail-panel--analysis">
                                  <h5>详细解读</h5>
                                  <div className="detail-panel__loading-row" aria-live="polite">
                                    <span
                                      className="detail-loading-panel__spinner detail-loading-panel__spinner--inline"
                                      aria-hidden="true"
                                    />
                                    <p className="detail-panel__subcopy">
                                      正在后台生成中文互联网视角下的详细解读，不影响你先看人物和来源。
                                    </p>
                                  </div>
                                </section>
                              ) : null}

                              {showProjectAnalysisError ? (
                                <section className="detail-panel detail-panel--wide detail-panel--analysis">
                                  <h5>详细解读</h5>
                                  <p className="detail-panel__subcopy">{analysisError ?? "详细解读暂时生成失败"}</p>
                                  <button
                                    type="button"
                                    className="text-action-button"
                                    onClick={(clickEvent) => {
                                      clickEvent.stopPropagation();
                                      setDetailReloadTokenById((current) => ({
                                        ...current,
                                        [event.stableId]: (current[event.stableId] ?? 0) + 1,
                                      }));
                                    }}
                                  >
                                    重试解读
                                  </button>
                                </section>
                              ) : null}

                              {secondarySourceLinks.length > 0 ? (
                                <section className="detail-panel">
                                  <h5>相关来源</h5>
                                  <div className="link-list">
                                    {secondarySourceLinks.map((sourceLink) => (
                                      <Link key={sourceLink.url} href={sourceLink.url} target="_blank" rel="noreferrer">
                                        {sourceLink.label}
                                      </Link>
                                    ))}
                                  </div>
                                </section>
                              ) : null}

                              <section className="detail-panel detail-panel--wide">
                                <h5>关联人物</h5>
                                {people.length > 0 ? (
                                  <>
                                    <div className="person-card-grid">
                                      {visiblePeople.map((person) => {
                                      const isSaved = savedPersonIds.has(person.stableId);
                                      const personMeta = getPersonMeta(person, event.sourceType);
                                      const paperInstitutionText = getPaperProfileInstitutionText(person);
                                      const paperEmails = getPaperProfileEmails(person);
                                      const readableLinks = getReadablePersonLinks(person, event.sourceType);
                                      const showPersonEvidence = shouldShowPersonEvidence(person, event.sourceType);

                                      return (
                                        <article key={person.stableId} className="person-card">
                                          <div className="person-card__header">
                                            <div>
                                              <h6>{person.name}</h6>
                                              <p>{getPersonSubline(person, event.sourceType)}</p>
                                            </div>
                                            <button
                                              type="button"
                                              className={`pipeline-add-button ${isSaved ? "is-saved" : ""}`}
                                              aria-label={
                                                isSaved ? `已将 ${person.name} 加入 Pipeline，点击移除` : `将 ${person.name} 加入 Pipeline`
                                              }
                                              onClick={(clickEvent) => {
                                                clickEvent.stopPropagation();

                                                if (isSaved) {
                                                  startTransition(() => {
                                                    void removeFromPipeline(person.stableId).catch((error) => {
                                                      setStatus(error instanceof Error ? error.message : "取消失败");
                                                    });
                                                  });
                                                  return;
                                                }

                                                startTransition(() => {
                                                  void saveToPipeline(person.stableId, event.stableId).catch((error) => {
                                                    setStatus(error instanceof Error ? error.message : "保存失败");
                                                  });
                                                });
                                              }}
                                            >
                                              <span className="pipeline-add-button__icon" aria-hidden="true">
                                                {isSaved ? "✓" : "+"}
                                              </span>
                                              <span className="pipeline-add-button__label">
                                                {isSaved ? (
                                                  <>
                                                    <span className="pipeline-add-button__label-line">已在Pipeline</span>
                                                    <span className="pipeline-add-button__label-line">点击移除</span>
                                                  </>
                                                ) : (
                                                  <span className="pipeline-add-button__label-line">加入Pipeline</span>
                                                )}
                                              </span>
                                            </button>
                                          </div>
                                          {personMeta.length > 0 ? (
                                            <div className="person-card__meta-row">
                                              {personMeta.map((item) => (
                                                <span key={`${person.stableId}-${item}`} className="person-card__meta-pill">
                                                  {item}
                                                </span>
                                              ))}
                                            </div>
                                          ) : null}
                                          {showPersonEvidence ? <p className="person-card__evidence">{person.evidenceSummaryZh}</p> : null}
                                          {event.sourceType === "arxiv" && (paperInstitutionText || paperEmails.length > 0) ? (
                                            <div className="link-list link-list--stacked">
                                              {paperInstitutionText ? (
                                                <p className="link-list__text">
                                                  <span>作者单位：</span>
                                                  <span>{paperInstitutionText}</span>
                                                </p>
                                              ) : null}
                                              {paperEmails.length > 0 ? (
                                                <p className="link-list__text">
                                                  <span>论文联系方式：</span>
                                                  {paperEmails.map((email, index) => (
                                                    <span key={`${person.stableId}-paper-email-${email}`}>
                                                      {index > 0 ? " / " : ""}
                                                      <Link href={`mailto:${email}`} target="_blank" rel="noreferrer">
                                                        {email}
                                                      </Link>
                                                    </span>
                                                  ))}
                                                </p>
                                              ) : null}
                                            </div>
                                          ) : null}
                                          {readableLinks.length > 0 ? (
                                            <div className="link-list link-list--stacked">
                                              {readableLinks.map((sourceLink) => (
                                              <p key={`${person.stableId}-${sourceLink.label}-${sourceLink.value}`} className="link-list__text">
                                                <span>{sourceLink.label}：</span>
                                                <Link href={sourceLink.href} target="_blank" rel="noreferrer">
                                                  {sourceLink.value}
                                                </Link>
                                              </p>
                                              ))}
                                            </div>
                                          ) : null}
                                        </article>
                                      );
                                      })}
                                    </div>
                                    {hasMorePeople ? (
                                      <div className="person-card-grid__actions">
                                        <button
                                          type="button"
                                          className="text-action-button"
                                          onClick={(clickEvent) => {
                                            clickEvent.stopPropagation();
                                            togglePeopleExpanded(event.stableId);
                                          }}
                                        >
                                          {peopleExpanded ? "收起人物" : "展开更多"}
                                        </button>
                                      </div>
                                    ) : null}
                                  </>
                                ) : (
                                  <div className="empty-state">暂未识别到明确关联人物</div>
                                )}
                                {status ? <p className="status-text">{status}</p> : null}
                              </section>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                </div>
              );
              })}
            </div>
          ) : (
            <div className="empty-state">
              {config.emptyState}
            </div>
          )
        ) : (
          <div className="board-section__collapsed">
            <p>该板块已折叠。展开后继续查看事件、人物与来源。</p>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="board-layout">
      {sectionsToRender.map((source) =>
        renderSection(source, source === "github" ? githubEvents : source === "kickstarter" ? eligibleKickstarterEvents : arxivEvents),
      )}
    </div>
  );
}
