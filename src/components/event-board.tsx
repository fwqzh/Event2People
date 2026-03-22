"use client";

import Link from "next/link";
import { startTransition, useEffect, useEffectEvent, useMemo, useState } from "react";

import type { EventView } from "@/lib/types";

type EventSource = "github" | "arxiv";

type EventBoardProps = {
  githubEvents: EventView[];
  arxivEvents: EventView[];
};

const DEFAULT_VISIBLE_COUNT = 10;
const PREVIEW_PEOPLE_LIMIT = 3;
const SECTION_CONFIG: Record<
  EventSource,
  {
    title: string;
    kicker: string;
    status: string;
    description: string;
  }
> = {
  github: {
    title: "GitHub",
    kicker: "Build / Execution",
    status: "GitHub Trending Daily",
    description: "基于 GitHub 官方 Trending Daily 页面动态解析，按 today stars 排序后展示 Top 10 项目事件。",
  },
  arxiv: {
    title: "arXiv",
    kicker: "Research / Entry",
    status: "arXiv + Semantic Scholar",
    description:
      "基于最近 30 天 arXiv 候选论文，经具身智能主题过滤后，再结合 Semantic Scholar 引用、venue 信号和新鲜度得到启发式 Top 10。",
  },
};

export function EventBoard({ githubEvents, arxivEvents }: EventBoardProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCounts, setVisibleCounts] = useState<Record<EventSource, number>>({
    github: DEFAULT_VISIBLE_COUNT,
    arxiv: DEFAULT_VISIBLE_COUNT,
  });
  const [collapsedSections, setCollapsedSections] = useState<Record<EventSource, boolean>>({
    github: false,
    arxiv: false,
  });
  const [newlySavedPersonIds, setNewlySavedPersonIds] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState("");

  const allEvents = useMemo(() => [...githubEvents, ...arxivEvents], [arxivEvents, githubEvents]);
  const savedPersonIds = useMemo(() => {
    const ids = new Set<string>();

    allEvents.forEach((event) => {
      if (event.isSaved) {
        event.personStableIds.forEach((personStableId) => ids.add(personStableId));
      }
    });

    newlySavedPersonIds.forEach((personStableId) => ids.add(personStableId));
    return ids;
  }, [allEvents, newlySavedPersonIds]);

  const totalMappedPeople = useMemo(() => new Set(allEvents.flatMap((event) => event.personStableIds)).size, [allEvents]);

  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setExpandedId(null);
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

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
    setStatus("已加入 Pipeline");
  }

  function toggleExpanded(stableId: string) {
    setExpandedId((current) => (current === stableId ? null : stableId));
  }

  function shouldIgnoreCardToggle(target: EventTarget | null) {
    return target instanceof HTMLElement && Boolean(target.closest("a, button, summary, details"));
  }

  function handleCardClick(stableId: string, target: EventTarget | null) {
    if (shouldIgnoreCardToggle(target)) {
      return;
    }

    toggleExpanded(stableId);
  }

  function getCardTitle(event: EventView) {
    if (event.sourceType === "arxiv") {
      return event.papers[0]?.paperTitle ?? event.eventTitleZh;
    }

    return event.eventTitleZh;
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

  function renderSection(source: EventSource, events: EventView[]) {
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
            <h2>
              {config.title} <span>· {events.length} 条近期事件</span>
            </h2>
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
              <button type="button" className="ghost-button" onClick={() => toggleSectionCollapse(source)}>
                {isCollapsed ? "展开板块" : "折叠板块"}
              </button>

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
              const showEventLens = event.detailSummary !== event.eventHighlightZh;

              return (
                <div key={event.stableId} className={`event-stack ${isExpanded ? "is-expanded" : ""}`}>
                  <article
                    className={`event-card ${isExpanded ? "is-expanded" : ""} ${isDimmed ? "is-dimmed" : ""}`}
                    onClick={(clickEvent) => handleCardClick(event.stableId, clickEvent.target)}
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
                      <h3>{getCardTitle(event)}</h3>
                      <p className="event-card__highlight" suppressHydrationWarning>
                        {event.cardSummary}
                      </p>
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
                        {event.people.length > 0 ? (
                          <>
                            {event.people.slice(0, PREVIEW_PEOPLE_LIMIT).map((person) => (
                              <Link
                                key={person.stableId}
                                href={person.links[0]?.url ?? "#"}
                                onClick={(clickEvent) => clickEvent.stopPropagation()}
                                target={person.links[0]?.url ? "_blank" : undefined}
                                rel={person.links[0]?.url ? "noreferrer" : undefined}
                              >
                                {person.name}
                              </Link>
                            ))}
                            {event.people.length > PREVIEW_PEOPLE_LIMIT ? (
                              <span>+{event.people.length - PREVIEW_PEOPLE_LIMIT} more</span>
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
                                  <span className="status-chip">{event.people.length} 人物</span>
                                  <span className="data-pill">{event.sourceLinks.length} 来源</span>
                                </div>
                              </div>
                              <h4>{getCardTitle(event)}</h4>
                              <p suppressHydrationWarning>{event.introSummary}</p>
                            </div>
                            <button type="button" className="close-button" onClick={() => setExpandedId(null)}>
                              收起
                            </button>
                          </div>

                          <div className="event-detail-grid">
                            <section className="detail-panel">
                              <h5>{event.sourceSummaryLabel}</h5>
                              <p suppressHydrationWarning>{event.detailSummary}</p>
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

                            <section className="detail-panel">
                              <h5>相关来源</h5>
                              <div className="link-list">
                                {event.sourceLinks.map((sourceLink) => (
                                  <Link key={sourceLink.url} href={sourceLink.url} target="_blank" rel="noreferrer">
                                    {sourceLink.label}
                                  </Link>
                                ))}
                              </div>
                            </section>

                            <section className="detail-panel detail-panel--wide">
                              <h5>关联人物</h5>
                              {event.people.length > 0 ? (
                                <div className="person-card-grid">
                                  {event.people.map((person) => {
                                    const isSaved = savedPersonIds.has(person.stableId);

                                    return (
                                      <article key={person.stableId} className="person-card">
                                        <div className="person-card__header">
                                          <div>
                                            <h6>{person.name}</h6>
                                            <p>{person.identitySummaryZh}</p>
                                          </div>
                                          <button
                                            type="button"
                                            className="primary-button"
                                            disabled={isSaved}
                                            onClick={(clickEvent) => {
                                              clickEvent.stopPropagation();
                                              startTransition(() => {
                                                void saveToPipeline(person.stableId, event.stableId).catch((error) => {
                                                  setStatus(error instanceof Error ? error.message : "保存失败");
                                                });
                                              });
                                            }}
                                          >
                                            {isSaved ? "已在 Pipeline" : "加入 Pipeline"}
                                          </button>
                                        </div>
                                        <p className="person-card__evidence">证据：{person.evidenceSummaryZh}</p>
                                        <div className="link-list">
                                          {person.links.map((sourceLink) => (
                                            <Link key={sourceLink.url} href={sourceLink.url} target="_blank" rel="noreferrer">
                                              {sourceLink.label}
                                            </Link>
                                          ))}
                                        </div>
                                      </article>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="empty-state">暂未识别到明确关联人物</div>
                              )}
                            </section>

                            <section className="detail-panel">
                              <h5>动作</h5>
                              <p>确认人物值得继续追踪后再保存。进入 Pipeline 后可统一复制摘要并查看联系入口。</p>
                              {status ? <p className="status-text">{status}</p> : null}
                            </section>
                          </div>
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
      <section className="toolbar-card toolbar-card--board">
        <div className="toolbar-card__copy">
          <span className="section-kicker">Event Board</span>
          <h2>在变化发生之处，看见人。</h2>
        </div>

        <div className="toolbar-card__cluster">
          <div className="toolbar-pill-group">
            <span className="toolbar-metric-pill">
              <strong>{allEvents.length}</strong>
              <em>Total events</em>
            </span>
            <span className="toolbar-metric-pill">
              <strong>{totalMappedPeople}</strong>
              <em>Mapped people</em>
            </span>
            <span className="toolbar-metric-pill">
              <strong>{savedPersonIds.size}</strong>
              <em>Already saved</em>
            </span>
          </div>
        </div>
      </section>

      {renderSection("github", githubEvents)}
      {renderSection("arxiv", arxivEvents)}
    </div>
  );
}
