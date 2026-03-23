// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventBoard } from "@/components/event-board";
import type { EventDetailView, EventSummaryView } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: React.ReactNode;
  }) => React.createElement("a", { href, ...props }, children),
}));

function createSummaryEvent(overrides: Partial<EventSummaryView> = {}): EventSummaryView {
  const stableId = overrides.stableId ?? "event:github:open-manu";

  return {
    stableId,
    sourceType: "github",
    eventType: "implementation",
    eventTag: "AI Agent",
    eventTagConfidence: 0.92,
    eventTitleZh: "open-manu",
    eventHighlightZh: "一个开源的多代理执行框架。",
    eventDetailSummaryZh: "一个开源的多代理执行框架。",
    timePrimary: new Date("2026-03-22T09:00:00.000Z"),
    metrics: [
      { label: "today stars", value: "+420" },
      { label: "Total Stars", value: "12400" },
    ],
    sourceLinks: [{ label: "GitHub", url: "https://github.com/example/open-manu" }],
    peopleDetectionStatus: "resolved",
    projectStableIds: ["project:open-manu"],
    paperStableIds: [],
    personStableIds: ["github:alice"],
    displayRank: 1,
    relatedRepoCount: 1,
    relatedPaperCount: 0,
    timeAgo: "2 小时前",
    cardTitle: "open-manu",
    previewPeople: [{ stableId: "github:alice", name: "Alice", primaryLinkUrl: "https://github.com/alice" }],
    peopleCount: 1,
    isSaved: false,
    cardSummary: "这是卡片上已经展示过的摘要。",
    ...overrides,
  };
}

function createDetail(overrides: Partial<EventDetailView> = {}): EventDetailView {
  return {
    stableId: "event:github:open-manu",
    sourceSummaryLabel: "项目概述",
    detailSummary: "这是展开后详情面板里的补充说明。",
    introSummary: "这是卡片上已经展示过的摘要。",
    people: [
      {
        stableId: "github:alice",
        name: "Alice",
        identitySummaryZh: "Open Source Builder",
        evidenceSummaryZh: "Repo owner",
        sourceUrls: ["https://github.com/alice"],
        links: [{ label: "GitHub", url: "https://github.com/alice" }],
      },
    ],
    ...overrides,
  };
}

function createResponse(detail: EventDetailView) {
  return {
    ok: true,
    json: async () => ({ detail }),
  };
}

describe("EventBoard", () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a loading state for expanded content and keeps GitHub copy deduplicated", async () => {
    const user = userEvent.setup();
    let resolveFetch: ((value: { ok: boolean; json: () => Promise<{ detail: EventDetailView }> }) => void) | null = null;
    const fetchPromise = new Promise<{ ok: boolean; json: () => Promise<{ detail: EventDetailView }> }>((resolve) => {
      resolveFetch = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes("/api/pipeline")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true, savedPersonStableIds: [] }),
          });
        }

        return fetchPromise;
      }),
    );

    render(
      React.createElement(EventBoard, {
        datasetVersionId: "dataset-1",
        savedPersonStableIds: [],
        githubEvents: [createSummaryEvent()],
        arxivEvents: [],
      }),
    );

    await user.click(screen.getByRole("button", { name: "展开 open-manu" }));

    expect(screen.getByText("正在加载当前卡片详情")).toBeInTheDocument();

    resolveFetch!(createResponse(createDetail()));

    await waitFor(() => {
      expect(screen.queryByText("正在加载当前卡片详情")).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "收起 open-manu" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "open-manu", level: 3 })).toBeInTheDocument();
    expect(screen.getAllByText("这是卡片上已经展示过的摘要。")).toHaveLength(1);
    expect(screen.getByText("链接：")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://github.com/example/open-manu" })).toBeInTheDocument();
    expect(screen.queryByText("这是展开后详情面板里的补充说明。")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "项目信号", level: 5 })).toHaveLength(1);
  });

  it("keeps the expanded GitHub intro as one paragraph after the detail request resolves", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes("/api/pipeline")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true, savedPersonStableIds: [] }),
          });
        }

        return Promise.resolve(
          createResponse(
            createDetail({
              stableId: "event:github:browserloop",
              introSummary: "browserloop 是一个精简介绍。这里接着补充更完整的项目说明，保持同一整段。",
              detailSummary: "这里原本会在下面另起一段介绍项目。",
              people: [],
            }),
          ),
        );
      }),
    );

    render(
      React.createElement(EventBoard, {
        datasetVersionId: "dataset-1",
        savedPersonStableIds: [],
        githubEvents: [
          createSummaryEvent({
            stableId: "event:github:browserloop",
            eventTitleZh: "browserloop",
            cardTitle: "browserloop",
            eventHighlightZh: "用于浏览器工作流的 agent 执行循环。",
            cardSummary: "browserloop 是一个精简介绍。",
            previewPeople: [],
            peopleCount: 0,
            personStableIds: [],
            sourceLinks: [{ label: "GitHub", url: "https://github.com/example/browserloop" }],
          }),
        ],
        arxivEvents: [],
      }),
    );

    await user.click(screen.getByRole("button", { name: /展开 browserloop/i }));

    expect(
      await screen.findByText("browserloop 是一个精简介绍。这里接着补充更完整的项目说明，保持同一整段。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("browserloop 是一个精简介绍。")).not.toBeInTheDocument();
    expect(screen.queryByText("这里原本会在下面另起一段介绍项目。")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "项目信号", level: 5 })).toHaveLength(1);
  });

  it("allows switching to another card while the previous detail request is still loading", async () => {
    const user = userEvent.setup();
    const deferredRequests = new Map<
      string,
      Promise<{ ok: boolean; json: () => Promise<{ detail: EventDetailView }> }>
    >();

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes("/api/pipeline")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true, savedPersonStableIds: [] }),
          });
        }

        const stableId = new URL(url, "http://localhost").searchParams.get("stableId");

        if (!stableId) {
          throw new Error("missing stableId");
        }

        const existing = deferredRequests.get(stableId);

        if (existing) {
          return existing;
        }

        const next = new Promise<{ ok: boolean; json: () => Promise<{ detail: EventDetailView }> }>(() => {
          return;
        });
        deferredRequests.set(stableId, next);
        return next;
      }),
    );

    render(
      React.createElement(EventBoard, {
        datasetVersionId: "dataset-1",
        savedPersonStableIds: [],
        githubEvents: [
          createSummaryEvent(),
          createSummaryEvent({
            stableId: "event:github:browserloop",
            eventTitleZh: "browserloop",
            cardTitle: "browserloop",
            displayRank: 2,
            previewPeople: [],
            peopleCount: 0,
            personStableIds: [],
            sourceLinks: [{ label: "GitHub", url: "https://github.com/example/browserloop" }],
          }),
        ],
        arxivEvents: [],
      }),
    );

    await user.click(screen.getByRole("button", { name: "展开 open-manu" }));
    expect(screen.getByText("正在加载当前卡片详情")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开 browserloop" }));

    expect(screen.getByRole("button", { name: "收起 browserloop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开 open-manu" })).toBeInTheDocument();
    expect(screen.getByText("正在加载当前卡片详情")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
