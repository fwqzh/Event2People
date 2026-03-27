// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventBoard } from "@/components/event-board";
import type { EventAnalysisView, EventDetailView, EventSummaryView } from "@/lib/types";

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
        contributionCount: 0,
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

function createAnalysisResponse(analysis: Partial<EventAnalysisView> = {}) {
  return {
    ok: true,
    json: async () => ({
      analysis: {
        stableId: "event:github:open-manu",
        analysisSummary: null,
        analysisReferences: [],
        ...analysis,
      },
    }),
  };
}

describe("EventBoard", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a loading state for expanded content and keeps GitHub copy deduplicated", async () => {
    const user = userEvent.setup();
    let resolveDetailFetch: ((value: { ok: boolean; json: () => Promise<{ detail: EventDetailView }> }) => void) | null = null;
    const detailFetchPromise = new Promise<{ ok: boolean; json: () => Promise<{ detail: EventDetailView }> }>((resolve) => {
      resolveDetailFetch = resolve;
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

        if (url.includes("/api/events/analysis")) {
          return Promise.resolve(createAnalysisResponse());
        }

        return detailFetchPromise;
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

    expect(await screen.findByText("正在打开当前卡片详情")).toBeInTheDocument();

    resolveDetailFetch!(createResponse(createDetail()));

    await waitFor(() => {
      expect(screen.queryByText("正在打开当前卡片详情")).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "收起 open-manu" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "open-manu", level: 3 })).toBeInTheDocument();
    expect(screen.getAllByText("这是卡片上已经展示过的摘要。")).toHaveLength(1);
    expect(screen.getByText("链接：")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://github.com/example/open-manu" })).toBeInTheDocument();
    expect(screen.queryByText("这是展开后详情面板里的补充说明。")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "项目信号", level: 5 })).toHaveLength(1);
  }, 15_000);

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
    expect(await screen.findByText("正在打开当前卡片详情")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开 browserloop" }));

    expect(screen.getByRole("button", { name: "收起 browserloop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开 open-manu" })).toBeInTheDocument();
    expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("retries a card after its previous detail request was aborted", async () => {
    const user = userEvent.setup();
    let planningKernelDetailCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/pipeline")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true, savedPersonStableIds: [] }),
          });
        }

        const stableId = new URL(url, "http://localhost").searchParams.get("stableId");

        if (stableId === "event:arxiv:planning-kernel") {
          planningKernelDetailCalls += 1;

          if (planningKernelDetailCalls === 1) {
            return new Promise((_, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => {
                  reject(new DOMException("The operation was aborted.", "AbortError"));
                },
                { once: true },
              );
            });
          }

          return Promise.resolve(
            createResponse(
              createDetail({
                stableId: "event:arxiv:planning-kernel",
                sourceSummaryLabel: "论文解读",
                introSummary: "planning kernel detail",
                people: [],
              }),
            ),
          );
        }

        if (stableId === "event:arxiv:policy-stack") {
          return Promise.resolve(
            createResponse(
              createDetail({
                stableId: "event:arxiv:policy-stack",
                sourceSummaryLabel: "论文解读",
                introSummary: "policy stack detail",
                people: [],
              }),
            ),
          );
        }

        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(
      React.createElement(EventBoard, {
        datasetVersionId: "dataset-1",
        savedPersonStableIds: [],
        githubEvents: [],
        arxivEvents: [
          createSummaryEvent({
            stableId: "event:arxiv:planning-kernel",
            sourceType: "arxiv",
            eventType: "new_paper",
            eventTitleZh: "新 paper “Planning Kernel” 发布",
            cardTitle: "Planning Kernel",
            eventHighlightZh: "复杂任务规划方向出现一个新的研究入口。",
            projectStableIds: [],
            paperStableIds: ["paper:planning-kernel"],
            previewPeople: [],
            peopleCount: 0,
            personStableIds: [],
            sourceLinks: [{ label: "Paper", url: "https://arxiv.org/abs/2603.01001" }],
          }),
          createSummaryEvent({
            stableId: "event:arxiv:policy-stack",
            sourceType: "arxiv",
            eventType: "new_paper",
            eventTitleZh: "新 paper “Policy Stack” 发布",
            cardTitle: "Policy Stack",
            eventHighlightZh: "具身智能 policy stack 新论文值得跟进。",
            projectStableIds: [],
            paperStableIds: ["paper:policy-stack"],
            previewPeople: [],
            peopleCount: 0,
            personStableIds: [],
            displayRank: 2,
            sourceLinks: [{ label: "Paper", url: "https://arxiv.org/abs/2603.01002" }],
          }),
        ],
      }),
    );

    await user.click(screen.getByRole("button", { name: "展开 Planning Kernel" }));
    expect(await screen.findByText("正在打开当前卡片详情")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开 Policy Stack" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "收起 Policy Stack" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "展开 Planning Kernel" }));

    await waitFor(() => {
      expect(planningKernelDetailCalls).toBe(2);
    });
  });

  it("shows a structured Chinese paper explanation for arxiv cards", async () => {
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
              stableId: "event:arxiv:planning-kernel",
              sourceSummaryLabel: "论文解读",
              detailSummary: "这篇论文聚焦复杂任务规划，重点是把长链路决策拆成可组合的基础模块。",
              introSummary: "这篇论文聚焦复杂任务规划，重点是把长链路决策拆成可组合的基础模块。",
              paperExplanation: {
                lead: "这篇论文聚焦复杂任务规划，重点是把长链路决策拆成可组合的基础模块。",
                problem: "这篇论文想解决的是复杂任务规划场景里决策链路长、步骤容易失稳的问题。",
                method: "方法上，它提出了一套规划内核与决策原语，把任务拆成更清晰的决策步骤。",
                contribution: "核心贡献是把规划问题沉淀成更通用的基础模块，方便继续复用到不同任务链路里。",
              },
              paperMetadata: {
                publishedAtLabel: "2025-03-02",
                institutions: ["Tsinghua University", "Shanghai AI Lab"],
                topic: "复杂任务规划",
                keywords: ["复杂任务规划", "规划内核与决策原语", "具身智能任务"],
              },
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
        githubEvents: [],
        arxivEvents: [
          createSummaryEvent({
            stableId: "event:arxiv:planning-kernel",
            sourceType: "arxiv",
            eventType: "new_paper",
            eventTitleZh: "新 paper “Embodied Planning Kernel” 发布",
            cardTitle: "Embodied Planning Kernel",
            eventHighlightZh: "具身智能规划方向出现值得优先跟进的新入口。",
            cardSummary: "这篇论文聚焦复杂任务规划，重点是把长链路决策拆成可组合的基础模块。",
            projectStableIds: [],
            paperStableIds: ["paper:embodied-planning-kernel"],
            sourceLinks: [{ label: "Paper", url: "https://arxiv.org/abs/2503.01022" }],
            previewPeople: [],
            peopleCount: 0,
            personStableIds: [],
          }),
        ],
      }),
    );

    await user.click(screen.getByRole("button", { name: "展开 Embodied Planning Kernel" }));

    expect(await screen.findByText("论文解决了什么问题")).toBeInTheDocument();
    expect(screen.getByText("用了什么方法")).toBeInTheDocument();
    expect(screen.getByText("核心贡献是什么")).toBeInTheDocument();
    expect(screen.getByText("ArXiv 网页：")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://arxiv.org/abs/2503.01022" })).toBeInTheDocument();
    expect(screen.getByText("论文发表时间")).toBeInTheDocument();
    expect(screen.getByText("2025-03-02")).toBeInTheDocument();
    expect(screen.getByText("作者主要机构")).toBeInTheDocument();
    expect(screen.getByText("Tsinghua University / Shanghai AI Lab")).toBeInTheDocument();
    expect(screen.getByText("论文主题")).toBeInTheDocument();
    expect(screen.getAllByText("复杂任务规划").length).toBeGreaterThan(0);
    expect(screen.getByText("论文关键词")).toBeInTheDocument();
    expect(screen.getByText("复杂任务规划 / 规划内核与决策原语 / 具身智能任务")).toBeInTheDocument();
    expect(screen.getAllByText("这篇论文聚焦复杂任务规划，重点是把长链路决策拆成可组合的基础模块。")).toHaveLength(1);
    expect(screen.getByText("这篇论文想解决的是复杂任务规划场景里决策链路长、步骤容易失稳的问题。")).toBeInTheDocument();
    expect(screen.getByText("方法上，它提出了一套规划内核与决策原语，把任务拆成更清晰的决策步骤。")).toBeInTheDocument();
    expect(screen.getByText("核心贡献是把规划问题沉淀成更通用的基础模块，方便继续复用到不同任务链路里。")).toBeInTheDocument();
  });
});
