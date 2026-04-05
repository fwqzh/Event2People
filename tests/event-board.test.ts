// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventBoard } from "@/components/event-board";
import type { EventAnalysisView, EventDetailView, EventSummaryView } from "@/lib/types";

const routerReplaceMock = vi.fn();
let mockPathname = "/github";
let mockSearchParams = new URLSearchParams();

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

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
  useSearchParams: () => mockSearchParams,
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

function createArxivSummaryEvent(overrides: Partial<EventSummaryView> = {}): EventSummaryView {
  const stableId = overrides.stableId ?? "event:arxiv:agent-bot-stack";
  const publishedAt = overrides.paperSummaryMetadata?.publishedAtTs
    ? new Date(overrides.paperSummaryMetadata.publishedAtTs)
    : new Date("2026-03-24T09:00:00.000Z");

  return createSummaryEvent({
    stableId,
    sourceType: "arxiv",
    eventType: "new_paper",
    eventTag: "AI Agent",
    eventTagConfidence: 0.9,
    eventTitleZh: `新 paper “${overrides.cardTitle ?? "Agent Bot Stack"}” 发布`,
    eventHighlightZh: "研究入口出现新论文。",
    eventDetailSummaryZh: "论文与实现、人物关系可直接追溯到原始页面。",
    timePrimary: publishedAt,
    metrics: [
      { label: "时间", value: "近期" },
      { label: "authors", value: "2" },
      { label: "code", value: "无" },
    ],
    sourceLinks: [{ label: "Paper", url: `https://arxiv.org/abs/${stableId.replace(/[^0-9]/g, "").slice(0, 10) || "2603.01022"}` }],
    projectStableIds: [],
    paperStableIds: [`paper:${stableId.split(":").pop()}`],
    personStableIds: [],
    previewPeople: [],
    peopleCount: 0,
    cardTitle: overrides.cardTitle ?? "Agent Bot Stack",
    cardSummary: overrides.cardSummary ?? "这篇论文围绕 agent 与 bot 执行链路展开。",
    paperSummaryMetadata: {
      publishedAtLabel: "2026-03-24",
      publishedAtTs: publishedAt.getTime(),
      topic: "Agent 执行链路",
      keywords: ["Agent 执行链路", "bot"],
    },
    ...overrides,
  });
}

describe("EventBoard", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockPathname = "/github";
    mockSearchParams = new URLSearchParams();
    routerReplaceMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts preloading GitHub detail and analysis before the card is expanded", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
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

      return Promise.resolve(createResponse(createDetail()));
    });

    vi.stubGlobal("fetch", fetchMock);

    render(
      React.createElement(EventBoard, {
        datasetVersionId: "dataset-1",
        savedPersonStableIds: [],
        githubEvents: [createSummaryEvent()],
        arxivEvents: [],
      }),
    );

    await vi.advanceTimersByTimeAsync(400);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/events/detail?stableId=event%3Agithub%3Aopen-manu"),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/events/analysis?stableId=event%3Agithub%3Aopen-manu"),
      expect.anything(),
    );
    expect(screen.getByRole("button", { name: "展开 open-manu" })).toBeInTheDocument();
  });

  it("does not refetch detail or analysis after collapsing and reopening the same loaded GitHub card", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/pipeline")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, savedPersonStableIds: [] }),
        });
      }

      if (url.includes("/api/events/analysis")) {
        return Promise.resolve(
          createAnalysisResponse({
            analysisSummary: "这是已经生成好的详细解读。",
            analysisReferences: [{ label: "知乎", title: "项目介绍", url: "https://www.zhihu.com/question/1" }],
          }),
        );
      }

      return Promise.resolve(createResponse(createDetail()));
    });

    vi.stubGlobal("fetch", fetchMock);

    render(
      React.createElement(EventBoard, {
        datasetVersionId: "dataset-1",
        savedPersonStableIds: [],
        githubEvents: [createSummaryEvent()],
        arxivEvents: [],
      }),
    );

    await user.click(screen.getByRole("button", { name: "展开 open-manu" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "收起 open-manu" })).toBeInTheDocument();
    });

    const requestCountAfterFirstOpen = fetchMock.mock.calls.filter(([input]) => {
      const url = String(input);
      return url.includes("/api/events/detail") || url.includes("/api/events/analysis");
    }).length;

    await user.click(screen.getByRole("button", { name: "收起 open-manu" }));
    await user.click(screen.getByRole("button", { name: "展开 open-manu" }));
    await new Promise((resolve) => window.setTimeout(resolve, 500));

    const requestCountAfterReopen = fetchMock.mock.calls.filter(([input]) => {
      const url = String(input);
      return url.includes("/api/events/detail") || url.includes("/api/events/analysis");
    }).length;

    expect(requestCountAfterReopen).toBe(requestCountAfterFirstOpen);
    expect(screen.queryByText("正在打开当前卡片详情")).not.toBeInTheDocument();
  }, 15_000);

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

  it("keeps background detail preloading alive when switching cards and reuses it on reopen", async () => {
    const user = userEvent.setup();
    let planningKernelDetailCalls = 0;
    let planningKernelRequestAborted = false;
    let resolvePlanningKernelDetail: ((value: { ok: boolean; json: () => Promise<{ detail: EventDetailView }> }) => void) | null =
      null;

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

        if (url.includes("/api/events/analysis")) {
          return Promise.resolve(
            createAnalysisResponse({
              stableId: new URL(url, "http://localhost").searchParams.get("stableId") ?? "event:arxiv:planning-kernel",
              paperExplanation: {
                lead: "analysis fallback",
                problem: "analysis fallback",
                method: "analysis fallback",
                contribution: "analysis fallback",
              },
            }),
          );
        }

        const stableId = new URL(url, "http://localhost").searchParams.get("stableId");

        if (stableId === "event:arxiv:planning-kernel") {
          planningKernelDetailCalls += 1;

          if (planningKernelDetailCalls === 1) {
            return new Promise<{ ok: boolean; json: () => Promise<{ detail: EventDetailView }> }>((resolve) => {
              resolvePlanningKernelDetail = resolve;
              init?.signal?.addEventListener("abort", () => {
                planningKernelRequestAborted = true;
              });
            });
          }

          return Promise.resolve(
            createResponse(
              createDetail({
                stableId: "event:arxiv:planning-kernel",
                sourceSummaryLabel: "论文概览",
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
                sourceSummaryLabel: "论文概览",
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
    expect(planningKernelDetailCalls).toBe(1);
    expect(planningKernelRequestAborted).toBe(false);

    resolvePlanningKernelDetail!(
      createResponse(
        createDetail({
          stableId: "event:arxiv:planning-kernel",
          sourceSummaryLabel: "论文概览",
          introSummary: "planning kernel detail",
          people: [],
        }),
      ),
    );

    expect(await screen.findByText("planning kernel detail")).toBeInTheDocument();
    expect(planningKernelRequestAborted).toBe(false);
  }, 15_000);

  it("hydrates arxiv cards with structured sourced paper analysis", async () => {
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

        if (url.includes("/api/events/analysis")) {
          return Promise.resolve(
            createAnalysisResponse({
              stableId: "event:arxiv:planning-kernel",
              analysisSummary:
                "这篇论文把复杂任务规划拆成更稳定的决策单元，重点不是泛泛讨论 agent 规划，而是把长链任务里的关键判断点做成可组合模块。[1]\n\n中文来源普遍把它理解成一种更利于工程复用的规划底座，这也是它比单次任务优化更值得跟进的地方。[2]",
              paperExplanation: {
                lead: "这篇论文聚焦复杂任务规划，重点是把长链路决策拆成可组合的基础模块。",
                problem:
                  "这篇论文想解决的是复杂任务规划场景里决策链路长、步骤容易失稳的问题，中文解读普遍把它归到“把长任务拆成更稳定规划单元”的方向。[1]",
                method:
                  "方法上，它提出了一套规划内核与决策原语，把任务拆成更清晰的决策步骤，并通过模块化接口把推理和执行重新接起来。[1] [2]",
                contribution:
                  "核心贡献是把规划问题沉淀成更通用的基础模块，既方便横向复用，也降低了后续工程侧继续接入的门槛。[2]",
              },
              analysisReferences: [
                {
                  label: "机器之心",
                  title: "Embodied Planning Kernel 论文解读",
                  url: "https://www.jiqizhixin.com/articles/planning-kernel",
                },
                {
                  label: "量子位",
                  title: "Planning Kernel: 把长链规划拆成基础模块",
                  url: "https://www.qbitai.com/2026/03/planning-kernel.html",
                },
              ],
            }),
          );
        }

        return Promise.resolve(
          createResponse(
            createDetail({
              stableId: "event:arxiv:planning-kernel",
              sourceSummaryLabel: "论文概览",
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
                authors: ["Jian Wu", "Sofia Garcia"],
                authorEmails: ["jian@tsinghua.edu.cn", "sofia@mit.edu"],
                institutions: ["Tsinghua University", "Shanghai AI Lab"],
                leadAuthorAffiliations: [
                  { author: "Jian Wu", institutions: ["Tsinghua University"] },
                  { author: "Sofia Garcia", institutions: ["Shanghai AI Lab"] },
                ],
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
    expect(
      await screen.findByText(
        "这篇论文把复杂任务规划拆成更稳定的决策单元，重点不是泛泛讨论 agent 规划，而是把长链任务里的关键判断点做成可组合模块。[1]",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "详细解读", level: 5 }).compareDocumentPosition(screen.getByText("论文发表时间")),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("ArXiv 网页：")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://arxiv.org/abs/2503.01022" })).toBeInTheDocument();
    expect(screen.getByText("论文发表时间")).toBeInTheDocument();
    expect(screen.getByText("2025-03-02")).toBeInTheDocument();
    expect(screen.getByText("作者名单")).toBeInTheDocument();
    expect(screen.getByText("Jian Wu / Sofia Garcia")).toBeInTheDocument();
    expect(screen.getByText("作者邮箱")).toBeInTheDocument();
    expect(screen.getByText("jian@tsinghua.edu.cn / sofia@mit.edu")).toBeInTheDocument();
    expect(screen.getByText("主要作者单位")).toBeInTheDocument();
    expect(screen.getByText("Jian Wu：Tsinghua University；Sofia Garcia：Shanghai AI Lab")).toBeInTheDocument();
    expect(screen.getByText("论文主题")).toBeInTheDocument();
    expect(screen.getAllByText("复杂任务规划").length).toBeGreaterThan(0);
    expect(screen.getByText("论文关键词")).toBeInTheDocument();
    expect(screen.getByText("复杂任务规划 / 规划内核与决策原语 / 具身智能任务")).toBeInTheDocument();
    expect(screen.getAllByText("这篇论文聚焦复杂任务规划，重点是把长链路决策拆成可组合的基础模块。")).toHaveLength(1);
    expect(
      screen.getByText(
        "方法上，它提出了一套规划内核与决策原语，把任务拆成更清晰的决策步骤，并通过模块化接口把推理和执行重新接起来。[1] [2]",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "核心贡献是把规划问题沉淀成更通用的基础模块，既方便横向复用，也降低了后续工程侧继续接入的门槛。[2]",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "中文来源普遍把它理解成一种更利于工程复用的规划底座，这也是它比单次任务优化更值得跟进的地方。[2]",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("引用来源")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Embodied Planning Kernel 论文解读" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Planning Kernel: 把长链规划拆成基础模块" })).toBeInTheDocument();
  });

  it("shows pdf-extracted affiliations and contact emails on arxiv author cards", async () => {
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

        if (url.includes("/api/events/analysis")) {
          return Promise.resolve(createAnalysisResponse());
        }

        return Promise.resolve(
          createResponse(
            createDetail({
              stableId: "event:arxiv:planning-kernel",
              sourceSummaryLabel: "论文概览",
              detailSummary: "这篇论文聚焦复杂任务规划。",
              introSummary: "这篇论文聚焦复杂任务规划。",
              people: [
                {
                  stableId: "author:jian-wu",
                  name: "Jian Wu",
                  identitySummaryZh: "AI 研究者 · arXiv 作者",
                  evidenceSummaryZh: "是当前论文作者",
                  sourceUrls: [],
                  links: [],
                  contributionCount: 0,
                  paperAuthorProfile: {
                    author: "Jian Wu",
                    institutions: ["Tsinghua University"],
                    emails: ["jian@tsinghua.edu.cn"],
                  },
                },
              ],
              paperMetadata: {
                publishedAtLabel: "2025-03-02",
                authors: ["Jian Wu"],
                authorEmails: ["jian@tsinghua.edu.cn"],
                institutions: ["Tsinghua University"],
                leadAuthorAffiliations: [{ author: "Jian Wu", institutions: ["Tsinghua University"] }],
                topic: "复杂任务规划",
                keywords: ["复杂任务规划"],
              },
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
          createArxivSummaryEvent({
            stableId: "event:arxiv:planning-kernel",
            cardTitle: "Embodied Planning Kernel",
            sourceLinks: [{ label: "Paper", url: "https://arxiv.org/abs/2503.01022" }],
            previewPeople: [],
            peopleCount: 0,
            personStableIds: [],
          }),
        ],
      }),
    );

    await user.click(screen.getByRole("button", { name: "展开 Embodied Planning Kernel" }));

    expect(await screen.findByText("论文单位：")).toBeInTheDocument();
    expect(screen.queryByText("是当前论文作者")).not.toBeInTheDocument();
    expect(screen.getByText("论文联系方式：")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "jian@tsinghua.edu.cn" })).toHaveAttribute("href", "mailto:jian@tsinghua.edu.cn");
    const authorCardHeading = screen.getByRole("heading", { name: "Jian Wu", level: 6 });
    const authorCard = authorCardHeading.closest("article");

    expect(authorCard).not.toBeNull();
    expect(within(authorCard as HTMLElement).getAllByText("Tsinghua University")).toHaveLength(1);
  });

  it("shows arxiv filters and keeps the default list at the first 20 matching papers", async () => {
    const user = userEvent.setup();
    mockPathname = "/arxiv";

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

        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const arxivEvents = Array.from({ length: 22 }, (_, index) =>
      createArxivSummaryEvent({
        stableId: `event:arxiv:paper-${index + 1}`,
        cardTitle: `Filtered Paper ${index + 1}`,
        sourceLinks: [{ label: "Paper", url: `https://arxiv.org/abs/2603.${String(index + 1000).padStart(5, "0")}` }],
      }),
    );

    render(
      React.createElement(EventBoard, {
        datasetVersionId: "dataset-arxiv",
        savedPersonStableIds: [],
        githubEvents: [],
        arxivEvents,
        visibleSources: ["arxiv"],
        enableArxivFilters: true,
      }),
    );

    expect(screen.getByRole("group", { name: "论文时间筛选" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "论文类目筛选" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "全部" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Agent" })).not.toBeChecked();
    expect(screen.getByText("22 / 22 篇匹配")).toBeInTheDocument();
    expect(screen.getByText("Filtered Paper 1")).toBeInTheDocument();
    expect(screen.getByText("Filtered Paper 20")).toBeInTheDocument();
    expect(screen.queryByText("Filtered Paper 21")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看更多结果" }));

    expect(screen.getByText("Filtered Paper 21")).toBeInTheDocument();
    expect(screen.getByText("Filtered Paper 22")).toBeInTheDocument();
  });

  it("filters arxiv papers by time and category, then syncs the URL and shows underflow guidance", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-03-26T12:00:00.000Z").getTime());
    const user = userEvent.setup();
    mockPathname = "/arxiv";

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

        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(
      React.createElement(EventBoard, {
        datasetVersionId: "dataset-arxiv",
        savedPersonStableIds: [],
        githubEvents: [],
        arxivEvents: [
          createArxivSummaryEvent({
            stableId: "event:arxiv:agent-bot-stack",
            cardTitle: "Agent Bot Stack",
            cardSummary: "这篇论文把 agent 与 bot 执行链路串起来。",
            paperSummaryMetadata: {
              publishedAtLabel: "2026-03-24",
              publishedAtTs: new Date("2026-03-24T10:00:00.000Z").getTime(),
              topic: "Agent 执行链路",
              keywords: ["Agent 执行链路", "bot"],
            },
          }),
          createArxivSummaryEvent({
            stableId: "event:arxiv:wm-lab",
            cardTitle: "World Model Lab",
            eventTag: "World Model",
            cardSummary: "这篇论文主要关注 world model 与仿真。",
            paperSummaryMetadata: {
              publishedAtLabel: "2026-03-20",
              publishedAtTs: new Date("2026-03-20T10:00:00.000Z").getTime(),
              topic: "环境建模与仿真",
              keywords: ["环境建模与仿真", "wm"],
            },
          }),
          createArxivSummaryEvent({
            stableId: "event:arxiv:old-agent-paper",
            cardTitle: "Old Agent Paper",
            cardSummary: "较早的一篇 agent 论文。",
            paperSummaryMetadata: {
              publishedAtLabel: "2025-12-15",
              publishedAtTs: new Date("2025-12-15T10:00:00.000Z").getTime(),
              topic: "Agent 执行链路",
              keywords: ["Agent 执行链路", "legacy"],
            },
          }),
        ],
        visibleSources: ["arxiv"],
        enableArxivFilters: true,
      }),
    );

    await user.click(screen.getByRole("checkbox", { name: "30天" }));
    await user.click(screen.getByRole("checkbox", { name: "Agent" }));

    expect(screen.getByText("1 / 3 篇匹配")).toBeInTheDocument();
    expect(screen.getByText("Agent Bot Stack")).toBeInTheDocument();
    expect(screen.queryByText("World Model Lab")).not.toBeInTheDocument();
    expect(screen.queryByText("Old Agent Paper")).not.toBeInTheDocument();
    expect(screen.getByText("当前仅找到 1 篇符合条件的论文。可尝试放宽时间窗，或清空类目筛选。")).toBeInTheDocument();
    expect(routerReplaceMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/arxiv?"),
      { scroll: false },
    );
    expect(String(routerReplaceMock.mock.lastCall?.[0])).toContain("time=30d");
    expect(String(routerReplaceMock.mock.lastCall?.[0])).toContain("categories=agent");

    await user.click(screen.getByRole("button", { name: "清空筛选" }));

    expect(screen.getByText("3 / 3 篇匹配")).toBeInTheDocument();
    expect(screen.getByText("World Model Lab")).toBeInTheDocument();
    expect(screen.getByText("Old Agent Paper")).toBeInTheDocument();
  });

  it("hydrates arxiv filters from the URL and keeps them disabled elsewhere", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T12:00:00.000Z"));
    mockPathname = "/arxiv";
    mockSearchParams = new URLSearchParams("time=7d&categories=agent&q=bot");

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

        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { rerender } = render(
      React.createElement(EventBoard, {
        datasetVersionId: "dataset-arxiv",
        savedPersonStableIds: [],
        githubEvents: [],
        arxivEvents: [
          createArxivSummaryEvent(),
          createArxivSummaryEvent({
            stableId: "event:arxiv:robotics",
            cardTitle: "Robot Control",
            eventTag: "Robotics",
            cardSummary: "这篇论文聚焦机器人控制与操作。",
            paperSummaryMetadata: {
              publishedAtLabel: "2026-03-24",
              publishedAtTs: new Date("2026-03-24T10:00:00.000Z").getTime(),
              topic: "机器人执行",
              keywords: ["机器人执行", "control"],
            },
          }),
        ],
        visibleSources: ["arxiv"],
        enableArxivFilters: true,
      }),
    );

    expect(screen.getByRole("checkbox", { name: "7天" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Agent" })).toBeChecked();
    expect(screen.getByText("1 / 2 篇匹配")).toBeInTheDocument();
    expect(screen.getByText("Agent Bot Stack")).toBeInTheDocument();
    expect(screen.queryByText("Robot Control")).not.toBeInTheDocument();
    await vi.runOnlyPendingTimersAsync();
    expect(String(routerReplaceMock.mock.lastCall?.[0])).toContain("time=7d");
    expect(String(routerReplaceMock.mock.lastCall?.[0])).toContain("categories=agent");
    expect(String(routerReplaceMock.mock.lastCall?.[0])).not.toContain("q=");

    mockPathname = "/github";
    mockSearchParams = new URLSearchParams("time=7d&q=bot");

    rerender(
      React.createElement(EventBoard, {
        datasetVersionId: "dataset-github",
        savedPersonStableIds: [],
        githubEvents: [createSummaryEvent()],
        arxivEvents: [createArxivSummaryEvent()],
        visibleSources: ["github"],
      }),
    );

    expect(screen.queryByRole("group", { name: "论文时间筛选" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "论文类目筛选" })).not.toBeInTheDocument();
  });
});
