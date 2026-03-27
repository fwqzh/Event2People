"use client";

import Link from "next/link";
import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import type { EventAnalysisView, EventDetailView, EventSummaryView, PersonView } from "@/lib/types";

type EventSource = "github" | "arxiv";
type EventDetailStatus = "idle" | "loading" | "ready" | "error";

type EventBoardProps = {
  datasetVersionId: string;
  savedPersonStableIds: string[];
  githubEvents: EventSummaryView[];
  arxivEvents: EventSummaryView[];
  visibleSources?: EventSource[];
};

const DEFAULT_VISIBLE_COUNT = 10;
const PREVIEW_PEOPLE_LIMIT = 3;
const EXPANDED_EVENT_STORAGE_KEY = "event-board-expanded-id";
const WARMUP_GITHUB_COUNT = 3;
const DETAIL_LOADING_DELAY_MS = 180;
const SECTION_CONFIG: Record<
  EventSource,
  {
    title: string;
    kicker: string;
    status: string;
    description: string;
    externalUrl?: string;
  }
> = {
  github: {
    title: "GitHub Trending",
    kicker: "Build / Execution",
    status: "GitHub Trending Daily",
    description: "基于 GitHub 官方 Trending Daily 页面动态解析，按 today stars 排序后展示 Top 10 项目事件。",
    externalUrl: "https://github.com/trending?since=daily",
  },
  arxiv: {
    title: "ArXiv Trending",
    kicker: "Research / Entry",
    status: "arXiv + Semantic Scholar",
    description:
      "基于最近 30 天 arXiv 候选论文，经具身智能主题过滤后，再结合 Semantic Scholar 引用、venue 信号和新鲜度得到启发式 Top 10。",
  },
};

export function EventBoard({
  datasetVersionId,
  savedPersonStableIds,
  githubEvents,
  arxivEvents,
  visibleSources,
}: EventBoardProps) {
  const detailRequestRef = useRef<{ stableId: string; controller: AbortController } | null>(null);
  const analysisRequestRef = useRef<{ stableId: string; controller: AbortController } | null>(null);
  const detailLoadingTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [serverSavedPersonIds, setServerSavedPersonIds] = useState<string[]>(savedPersonStableIds);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isExpandedIdHydrated, setIsExpandedIdHydrated] = useState(false);
  const [visibleCounts, setVisibleCounts] = useState<Record<EventSource, number>>({
    github: DEFAULT_VISIBLE_COUNT,
    arxiv: DEFAULT_VISIBLE_COUNT,
  });
  const [collapsedSections, setCollapsedSections] = useState<Record<EventSource, boolean>>({
    github: false,
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
  const [status, setStatus] = useState("");
  const sectionsToRender = visibleSources?.length ? [...new Set(visibleSources)] : (["github", "arxiv"] as EventSource[]);

  const allEvents = useMemo(() => [...githubEvents, ...arxivEvents], [arxivEvents, githubEvents]);
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

  const abortDetailRequest = useEffectEvent(() => {
    if (detailRequestRef.current) {
      const { stableId } = detailRequestRef.current;
      detailRequestRef.current.controller.abort();
      detailRequestRef.current = null;
      setDetailStatusById((current) =>
        current[stableId] === "loading" ? { ...current, [stableId]: "idle" } : current,
      );
      setDetailLoadingVisibleById((current) => ({ ...current, [stableId]: false }));
    }
  });

  const abortAnalysisRequest = useEffectEvent(() => {
    if (analysisRequestRef.current) {
      const { stableId } = analysisRequestRef.current;
      analysisRequestRef.current.controller.abort();
      analysisRequestRef.current = null;
      setAnalysisStatusById((current) =>
        current[stableId] === "loading" ? { ...current, [stableId]: "idle" } : current,
      );
    }
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

  const loadEventDetail = useEffectEvent(async (stableId: string) => {
    if (detailsById[stableId] || detailStatusById[stableId] === "loading") {
      return;
    }

    abortDetailRequest();

    const controller = new AbortController();
    detailRequestRef.current = { stableId, controller };
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

      if (detailRequestRef.current?.stableId === stableId) {
        detailRequestRef.current = null;
      }
    }
  });

  const loadEventAnalysis = useEffectEvent(async (stableId: string) => {
    const existingAnalysis = analysisById[stableId] ?? detailsById[stableId];

    if (
      analysisStatusById[stableId] === "loading" ||
      existingAnalysis?.analysisSummary ||
      existingAnalysis?.analysisReferences?.length
    ) {
      return;
    }

    abortAnalysisRequest();

    const controller = new AbortController();
    analysisRequestRef.current = { stableId, controller };
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
      if (analysisRequestRef.current?.stableId === stableId) {
        analysisRequestRef.current = null;
      }
    }
  });

  const warmEventCard = useEffectEvent(async (stableId: string) => {
    if (eventSourceById.get(stableId) === "github") {
      await Promise.allSettled([loadEventDetail(stableId), loadEventAnalysis(stableId)]);
      return;
    }

    await loadEventDetail(stableId);
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
    if (isExpandedIdHydrated) {
      return;
    }

    const storedExpandedId = window.sessionStorage.getItem(EXPANDED_EVENT_STORAGE_KEY);

    if (storedExpandedId && allEvents.some((event) => event.stableId === storedExpandedId)) {
      setExpandedId(storedExpandedId);
    } else if (storedExpandedId) {
      window.sessionStorage.removeItem(EXPANDED_EVENT_STORAGE_KEY);
    }

    setIsExpandedIdHydrated(true);
  }, [allEvents, isExpandedIdHydrated]);

  useEffect(() => {
    if (!isExpandedIdHydrated) {
      return;
    }

    if (expandedId && allEvents.some((event) => event.stableId === expandedId)) {
      window.sessionStorage.setItem(EXPANDED_EVENT_STORAGE_KEY, expandedId);
      return;
    }

    window.sessionStorage.removeItem(EXPANDED_EVENT_STORAGE_KEY);
  }, [allEvents, expandedId, isExpandedIdHydrated]);

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

  const expandedReloadToken = expandedId ? detailReloadTokenById[expandedId] ?? 0 : 0;

  useEffect(() => {
    if (!expandedId) {
      abortDetailRequest();
      abortAnalysisRequest();
      return;
    }

    void loadEventDetail(expandedId);
  }, [datasetVersionId, expandedId, expandedReloadToken, eventSourceById]);

  useEffect(() => {
    if (!expandedId || eventSourceById.get(expandedId) !== "github") {
      return;
    }

    void loadEventAnalysis(expandedId);
  }, [expandedId, expandedReloadToken, eventSourceById]);

  useEffect(() => {
    const warmIds = githubEvents.slice(0, WARMUP_GITHUB_COUNT).map((event) => event.stableId);
    let cancelled = false;
    let warmupHandle: ReturnType<typeof setTimeout> | null = null;

    const runWarmup = async () => {
      for (const stableId of warmIds) {
        if (cancelled) {
          return;
        }

        await warmEventCard(stableId);

        if (cancelled) {
          return;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
    };

    warmupHandle = window.setTimeout(() => {
      void runWarmup();
    }, 300);

    return () => {
      cancelled = true;

      if (warmupHandle !== null) {
        clearTimeout(warmupHandle);
      }
    };
  }, [datasetVersionId, githubEvents]);

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

  function getPersonMeta(person: PersonView) {
    return [person.organizationNamesRaw?.[0] ?? person.schoolNamesRaw?.[0] ?? person.labNamesRaw?.[0] ?? ""].filter(Boolean);
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

  function getReadablePersonLinks(person: EventDetailView["people"][number]) {
    return person.links.map((link) => {
      if (link.label === "Email") {
        const email = link.url.replace(/^mailto:/i, "");
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

      return {
        ...current,
        [source]:
          visibleCount >= totalCount
            ? DEFAULT_VISIBLE_COUNT
            : Math.min(visibleCount + DEFAULT_VISIBLE_COUNT, totalCount),
      };
    });
  }

  function renderSection(source: EventSource, events: EventSummaryView[]) {
    const config = SECTION_CONFIG[source];
    const isCollapsed = collapsedSections[source];
    const visibleCount = visibleCounts[source];
    const visibleEvents = events.slice(0, visibleCount);
    const sectionPersonIds = new Set(events.flatMap((event) => event.personStableIds));
    const sectionPeopleCount = sectionPersonIds.size;
    const savedInSectionCount = [...sectionPersonIds].filter((personStableId) => savedPersonIds.has(personStableId)).length;

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
                <span>· {events.length} 条近期事件</span>
              </h2>
            </div>
            <p className="board-section__copy">{config.description}</p>
          </div>

          <div className="board-section__aside">
            <div className="board-section__summary">
              <article className="section-stat">
                <span>Events</span>
                <strong>{events.length}</strong>
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
              {!isCollapsed && events.length > 10 ? (
                <button type="button" className="ghost-button" onClick={() => toggleVisibleCount(source, events.length)}>
                  {visibleCount >= events.length ? "收起列表" : "查看更多"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {!isCollapsed ? (
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
              const showPrimarySourceLinkInCard = isExpanded && event.sourceType === "github" && Boolean(primarySourceUrl);
              const showArxivPaperLinkInCard = isExpanded && event.sourceType === "arxiv" && Boolean(arxivPaperUrl);
              const highlightCopy = showExpandedIntroInCard ? detail!.introSummary : event.cardSummary;
              const showPaperExplanation = event.sourceType === "arxiv" && Boolean(detail?.paperExplanation);
              const showPaperMetadata = event.sourceType === "arxiv" && Boolean(detail?.paperMetadata);
              const showDetailSummaryInPanel =
                event.sourceType !== "github" && Boolean(detail) && !(event.sourceType === "arxiv" && showPaperExplanation);
              const showEventLens = Boolean(detail) && detail.detailSummary !== event.eventHighlightZh;
              const analysisParagraphs = getAnalysisParagraphs(analysis);
              const showBlockingDetailLoading = isDetailLoading && !detail && detailLoadingVisibleById[event.stableId];
              const showAnalysisLoading =
                isExpanded &&
                event.sourceType === "github" &&
                Boolean(detail) &&
                analysisParagraphs.length === 0 &&
                analysisStatus === "loading";
              const showAnalysisError =
                isExpanded &&
                event.sourceType === "github" &&
                Boolean(detail) &&
                analysisParagraphs.length === 0 &&
                analysisStatus === "error";
              const primaryDetailPanelTitle = event.sourceType === "github" ? "项目信号" : detail?.sourceSummaryLabel ?? "论文简介";
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
                        <span className="data-pill">{event.timeAgo}</span>
                      </div>
                    </div>

                    <div className="event-card__body">
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
                          <span className="event-card__primary-link-label">链接：</span>
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
                                {showPaperMetadata ? (
                                  <div className="paper-metadata-grid">
                                    <article className="paper-metadata-item">
                                      <strong>论文发表时间</strong>
                                      <p>{detail.paperMetadata!.publishedAtLabel || "暂未识别"}</p>
                                    </article>
                                    <article className="paper-metadata-item">
                                      <strong>作者主要机构</strong>
                                      <p>
                                        {detail.paperMetadata!.institutions.length > 0
                                          ? detail.paperMetadata!.institutions.join(" / ")
                                          : "暂未识别到主要机构"}
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

                              {analysisParagraphs.length > 0 ? (
                                <section className="detail-panel detail-panel--wide detail-panel--analysis">
                                  <h5>详细解读</h5>
                                  <div className="detail-analysis-copy">
                                    {analysisParagraphs.map((paragraph, index) => (
                                      <p key={`${event.stableId}-analysis-${index}`}>{paragraph}</p>
                                    ))}
                                  </div>
                                  {detail.analysisReferences && detail.analysisReferences.length > 0 ? (
                                    <div className="detail-analysis-references">
                                      <h6>中文互联网引用</h6>
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

                              {showAnalysisLoading ? (
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

                              {showAnalysisError ? (
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
                                      const personMeta = getPersonMeta(person);

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
                                          <p className="person-card__evidence">{person.evidenceSummaryZh}</p>
                                          <div className="link-list link-list--stacked">
                                            {getReadablePersonLinks(person).map((sourceLink) => (
                                              <p key={`${person.stableId}-${sourceLink.label}-${sourceLink.value}`} className="link-list__text">
                                                <span>{sourceLink.label}：</span>
                                                <Link href={sourceLink.href} target="_blank" rel="noreferrer">
                                                  {sourceLink.value}
                                                </Link>
                                              </p>
                                            ))}
                                          </div>
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
          <div className="board-section__collapsed">
            <p>该板块已折叠。展开后继续查看事件、人物与来源。</p>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="board-layout">
      {sectionsToRender.map((source) => renderSection(source, source === "github" ? githubEvents : arxivEvents))}
    </div>
  );
}
