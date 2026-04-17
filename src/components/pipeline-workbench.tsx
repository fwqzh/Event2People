"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { buildPipelineEntryCopy } from "@/lib/copy";
import type { PersonView, PipelineEntryView } from "@/lib/types";

type PipelineWorkbenchProps = {
  entries: PipelineEntryView[];
};

export function PipelineWorkbench({ entries }: PipelineWorkbenchProps) {
  const [localEntries, setLocalEntries] = useState(entries);
  const [status, setStatus] = useState("");
  const [expandedOriginalCards, setExpandedOriginalCards] = useState<Record<string, boolean>>({});
  const [copySuccessById, setCopySuccessById] = useState<Record<string, boolean>>({});
  const copyResetTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const contactableCount = localEntries.filter((entry) => entry.person.links.length > 0).length;

  function getPrimaryAffiliation(person: PersonView) {
    return person.organizationNamesRaw?.[0] ?? person.schoolNamesRaw?.[0] ?? person.labNamesRaw?.[0] ?? "";
  }

  function shouldShowIdentitySummary(entry: PipelineEntryView, primaryAffiliation: string) {
    return Boolean(entry.person.identitySummaryZh && entry.person.identitySummaryZh !== primaryAffiliation);
  }

  useEffect(() => {
    const copyResetTimers = copyResetTimersRef.current;

    return () => {
      copyResetTimers.forEach((timer) => clearTimeout(timer));
      copyResetTimers.clear();
    };
  }, []);

  function clearCopySuccessTimer(personStableId: string) {
    const existingTimer = copyResetTimersRef.current.get(personStableId);

    if (!existingTimer) {
      return;
    }

    clearTimeout(existingTimer);
    copyResetTimersRef.current.delete(personStableId);
  }

  async function copyEntry(entry: PipelineEntryView) {
    await navigator.clipboard.writeText(buildPipelineEntryCopy(entry));
    clearCopySuccessTimer(entry.personStableId);
    setCopySuccessById((current) => ({ ...current, [entry.personStableId]: true }));

    const nextTimer = setTimeout(() => {
      setCopySuccessById((current) => ({ ...current, [entry.personStableId]: false }));
      copyResetTimersRef.current.delete(entry.personStableId);
    }, 1000);

    copyResetTimersRef.current.set(entry.personStableId, nextTimer);
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
      throw new Error(payload.error ?? "移除失败");
    }

    clearCopySuccessTimer(personStableId);
    setLocalEntries((current) => {
      return current.filter((entry) => entry.personStableId !== personStableId);
    });
    setCopySuccessById((current) => {
      const next = { ...current };
      delete next[personStableId];
      return next;
    });
  }

  function toggleOriginalCard(personStableId: string) {
    setExpandedOriginalCards((current) => ({
      ...current,
      [personStableId]: !current[personStableId],
    }));
  }

  return (
    <div className="pipeline-layout">
      <div className="toolbar-card toolbar-card--workspace">
        <div className="toolbar-card__copy">
          <span className="section-kicker">Action Workspace</span>
          <h2>Pipeline</h2>
        </div>

        <div className="toolbar-card__cluster">
          <div className="toolbar-pill-group">
            <span className="toolbar-metric-pill">
              <strong>{localEntries.length}</strong>
              <em>Saved people</em>
            </span>
            <span className="toolbar-metric-pill">
              <strong>{contactableCount}</strong>
              <em>Has links</em>
            </span>
          </div>
        </div>
      </div>

      <div className="pipeline-grid pipeline-grid--single">
        <div className="pipeline-list pipeline-list--stacked">
          {localEntries.map((entry) => {
            const primaryAffiliation = getPrimaryAffiliation(entry.person);
            const showIdentitySummary = shouldShowIdentitySummary(entry, primaryAffiliation);
            const isOriginalCardExpanded = expandedOriginalCards[entry.personStableId] ?? false;
            const isCopySuccess = copySuccessById[entry.personStableId] ?? false;

            return (
              <article key={entry.personStableId} className="pipeline-card pipeline-card--simple">
                <div className="pipeline-card__utility">
                  <button
                    type="button"
                    className={`pipeline-copy-button ${isCopySuccess ? "is-success" : ""}`}
                    aria-label={isCopySuccess ? `${entry.person.name} 复制成功` : `复制 ${entry.person.name} 的信息`}
                    onClick={() => {
                      void copyEntry(entry).catch((error) => {
                        setStatus(error instanceof Error ? error.message : "复制失败");
                      });
                    }}
                  >
                    <span className="pipeline-copy-button__icon" aria-hidden="true">
                      <span className="pipeline-copy-button__sheet pipeline-copy-button__sheet--back" />
                      <span className="pipeline-copy-button__sheet pipeline-copy-button__sheet--front" />
                    </span>
                    <span className="pipeline-copy-button__tooltip" aria-hidden="true">
                      {isCopySuccess ? "复制成功" : "复制"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="pipeline-remove-button"
                    aria-label={`将 ${entry.person.name} 移除出 Pipeline`}
                    onClick={() => {
                      void removeFromPipeline(entry.personStableId).catch((error) => {
                        setStatus(error instanceof Error ? error.message : "移除失败");
                      });
                    }}
                  >
                    <span className="pipeline-remove-button__icon" aria-hidden="true">
                      ×
                    </span>
                    <span className="pipeline-remove-button__tooltip" aria-hidden="true">
                      移除
                    </span>
                  </button>
                </div>
                <div className="pipeline-card__content">
                  <header className="pipeline-card__header">
                    <div className="pipeline-card__headline">
                      {entry.sourceLabel ? <span className="pipeline-card__source-pill">{entry.sourceLabel}</span> : null}
                      <h3>{entry.person.name}</h3>
                      {primaryAffiliation ? <p className="pipeline-card__role">{primaryAffiliation}</p> : null}
                    </div>
                  </header>

                  {showIdentitySummary ? <p className="pipeline-card__summary">{entry.person.identitySummaryZh}</p> : null}

                  <section className="pipeline-card__section">
                    <span className="pipeline-card__section-label">项目原始链接</span>
                    <strong className="pipeline-card__item-title">
                      {entry.featuredItem?.title ?? entry.savedFromEventTitle}
                    </strong>
                    <p>{entry.featuredItem?.introZh ?? entry.person.identitySummaryZh}</p>
                    {entry.featuredItem?.url ? (
                      <div className="pipeline-card__actions">
                        <Link href={entry.featuredItem.url} target="_blank" rel="noreferrer" className="ghost-button">
                          查看项目/作品
                        </Link>
                      </div>
                    ) : null}
                    {entry.originalEvent ? (
                      <button
                        type="button"
                        className="pipeline-card__secondary-link"
                        onClick={() => toggleOriginalCard(entry.personStableId)}
                      >
                        {isOriginalCardExpanded ? "收起原始卡片" : "展开原始卡片"}
                      </button>
                    ) : null}
                    {isOriginalCardExpanded && entry.originalEvent ? (
                      <section className="pipeline-original-card">
                        <div className="pipeline-original-card__meta">
                          <span className="pipeline-card__source-pill">{entry.originalEvent.sourceLabel}</span>
                          <span className="pipeline-original-card__tag">{entry.originalEvent.eventTag}</span>
                          <span className="pipeline-original-card__time">{entry.originalEvent.timeAgo}</span>
                        </div>
                        <h4>{entry.originalEvent.title}</h4>
                        <p>{entry.originalEvent.summaryZh}</p>
                        {entry.originalEvent.sourceLinks.length > 0 ? (
                          <div className="pipeline-original-card__links">
                            {entry.originalEvent.sourceLinks.map((link) => (
                              <Link key={link.url} href={link.url} target="_blank" rel="noreferrer" className="pipeline-original-card__link">
                                {link.label}: {link.url}
                              </Link>
                            ))}
                          </div>
                        ) : null}
                        {entry.originalCardHref ? (
                          <Link href={entry.originalCardHref} className="pipeline-original-card__page-link">
                            在来源页打开
                          </Link>
                        ) : null}
                      </section>
                    ) : null}
                  </section>

                  <section className="pipeline-card__section">
                    <span className="pipeline-card__section-label">联系方式</span>
                    {entry.person.links.length > 0 ? (
                      <div className="pipeline-card__contact-list">
                        {entry.person.links.map((link) => (
                          <div key={link.url} className="pipeline-card__contact-item">
                            <span className="pipeline-card__contact-label">{link.label}</span>
                            <Link href={link.url} target="_blank" rel="noreferrer" className="pipeline-card__contact-url">
                              {link.url}
                            </Link>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="pipeline-card__muted">暂无可用联系渠道</p>
                    )}
                  </section>
                </div>
              </article>
            );
          })}
          {localEntries.length === 0 ? <div className="empty-state">当前 Pipeline 为空。</div> : null}
          {status ? <p className="status-text">{status}</p> : null}
        </div>
      </div>
    </div>
  );
}
