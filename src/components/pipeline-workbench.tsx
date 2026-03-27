"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { buildPipelinePageCopy } from "@/lib/copy";
import type { PipelineEntryView } from "@/lib/types";

type PipelineWorkbenchProps = {
  entries: PipelineEntryView[];
};

export function PipelineWorkbench({ entries }: PipelineWorkbenchProps) {
  const [localEntries, setLocalEntries] = useState(entries);
  const [selectedId, setSelectedId] = useState<string | null>(entries[0]?.personStableId ?? null);
  const [status, setStatus] = useState("");
  const selectedEntry = useMemo(
    () => localEntries.find((entry) => entry.personStableId === selectedId) ?? localEntries[0] ?? null,
    [localEntries, selectedId],
  );
  const contactableCount = useMemo(() => localEntries.filter((entry) => entry.person.links.length > 0).length, [localEntries]);

  function getPersonMeta(entry: PipelineEntryView) {
    return [
      entry.person.organizationNamesRaw?.[0] ?? entry.person.schoolNamesRaw?.[0] ?? entry.person.labNamesRaw?.[0] ?? "",
      entry.person.email ? `Email: ${entry.person.email}` : "",
    ].filter(Boolean);
  }

  async function copyText(text: string, successMessage: string) {
    await navigator.clipboard.writeText(text);
    setStatus(successMessage);
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

    setLocalEntries((current) => {
      const next = current.filter((entry) => entry.personStableId !== personStableId);

      setSelectedId((selected) => {
        if (selected !== personStableId) {
          return selected;
        }

        return next[0]?.personStableId ?? null;
      });

      return next;
    });
  }

  return (
    <div className="pipeline-layout">
      <div className="toolbar-card toolbar-card--workspace">
        <div className="toolbar-card__copy">
          <span className="section-kicker">Action Workspace</span>
          <h2>Pipeline</h2>
          <p>这里不再做“要不要跟进”的判断，只承接你已经确认值得继续追踪的人物与后续动作。</p>
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

          <div className="toolbar-card__actions">
            <Link href="/github" className="ghost-button ghost-button--inverse">
              返回 GitHub
            </Link>
            <button
              type="button"
              className="primary-button"
              onClick={() => void copyText(buildPipelinePageCopy(localEntries), "已复制本页摘要")}
            >
              复制本页摘要
            </button>
          </div>
        </div>
      </div>

      <div className="pipeline-grid">
        <div className="pipeline-list">
          {localEntries.map((entry) => {
            const personMeta = getPersonMeta(entry);

            return (
              <article
                key={entry.personStableId}
                className={`pipeline-card ${selectedEntry?.personStableId === entry.personStableId ? "is-selected" : ""}`}
              >
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
                  <span className="pipeline-remove-button__label">移除出Pipeline</span>
                </button>
                <button type="button" className="pipeline-card__body" onClick={() => setSelectedId(entry.personStableId)}>
                  <span className="pipeline-card__eyebrow">{entry.timeAgo} 加入</span>
                  <h3>{entry.person.name}</h3>
                  <p>{entry.person.identitySummaryZh}</p>
                  {personMeta.length > 0 ? (
                    <div className="person-card__meta-row">
                      {personMeta.map((item) => (
                        <span key={`${entry.personStableId}-${item}`} className="person-card__meta-pill">
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <span>来源事件：{entry.savedFromEventTitle}</span>
                  <strong>{entry.recentActivitySummaryZh}</strong>
                </button>

                <div className="pipeline-card__actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void copyText(entry.copySummaryShortZh ?? "", `已复制 ${entry.person.name}`)}
                  >
                    复制
                  </button>

                  <details className="contact-menu">
                    <summary>联系</summary>
                    <div className="contact-menu__panel">
                      {entry.person.links.length > 0 ? (
                        entry.person.links.map((link) => (
                          <Link key={link.url} href={link.url} target="_blank" rel="noreferrer">
                            {link.label}
                          </Link>
                        ))
                      ) : (
                        <span>暂无可用联系渠道</span>
                      )}
                    </div>
                  </details>

                  <button type="button" className="ghost-button" onClick={() => setSelectedId(entry.personStableId)}>
                    详情
                  </button>
                </div>
              </article>
            );
          })}
          {localEntries.length === 0 ? <div className="empty-state">当前 Pipeline 为空。</div> : null}
        </div>

        <aside className="detail-workbench">
          {selectedEntry ? (
            (() => {
              const personMeta = getPersonMeta(selectedEntry);

              return (
                <>
                  <span className="section-kicker">Selected Person</span>
                  <h3>{selectedEntry.person.name}</h3>
                  <p>{selectedEntry.person.identitySummaryZh}</p>
                  {personMeta.length > 0 ? (
                    <div className="person-card__meta-row">
                      {personMeta.map((item) => (
                        <span key={`${selectedEntry.personStableId}-detail-${item}`} className="person-card__meta-pill">
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <section className="detail-panel">
                    <h5>来源事件</h5>
                    <p>{selectedEntry.savedFromEventTitle}</p>
                  </section>

                  <section className="detail-panel">
                    <h5>证据</h5>
                    <p>{selectedEntry.person.evidenceSummaryZh}</p>
                  </section>

                  <section className="detail-panel">
                    <h5>最近活动</h5>
                    <p>{selectedEntry.recentActivitySummaryZh}</p>
                  </section>

                  <section className="detail-panel">
                    <h5>联系渠道</h5>
                    <div className="link-list">
                      {selectedEntry.person.links.length > 0 ? (
                        selectedEntry.person.links.map((link) => (
                          <Link key={link.url} href={link.url} target="_blank" rel="noreferrer">
                            {link.label}
                          </Link>
                        ))
                      ) : (
                        <span className="empty-state">暂无可用联系渠道</span>
                      )}
                    </div>
                  </section>

                  <section className="detail-panel">
                    <h5>复制摘要</h5>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void copyText(selectedEntry.copySummaryFullZh ?? "", `已复制 ${selectedEntry.person.name} 的完整摘要`)}
                    >
                      复制完整摘要
                    </button>
                  </section>
                </>
              );
            })()
          ) : (
            <div className="empty-state">尚未保存任何人物。</div>
          )}

          {status ? <p className="status-text">{status}</p> : null}
        </aside>
      </div>
    </div>
  );
}
