import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, ensureActiveDatasetMock } = vi.hoisted(() => ({
  prismaMock: {
    pipelineEntry: {
      findMany: vi.fn(),
    },
    person: {
      findMany: vi.fn(),
    },
    event: {
      findMany: vi.fn(),
    },
  },
  ensureActiveDatasetMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/seed", () => ({
  ensureActiveDataset: ensureActiveDatasetMock,
  parseLinks: (value: unknown) => (Array.isArray(value) ? value : []),
  parseMetrics: () => [],
}));

import { getPipelineData } from "@/lib/data";

function createPipelineEntry(overrides: Record<string, unknown> = {}) {
  return {
    personStableId: "github:alice-chen",
    savedAt: new Date("2026-04-15T12:00:00.000Z"),
    savedFromEventStableId: "event:github:vox-agent",
    savedFromEventTitle: "vox-agent",
    recentActivitySummaryZh: "最近活动：创建 repo VoxAgent，近 7 天 +312 stars",
    copySummaryShortZh: null,
    copySummaryFullZh: null,
    status: null,
    lastContactedAt: null,
    notes: null,
    ...overrides,
  };
}

function createPerson(overrides: Record<string, unknown> = {}) {
  return {
    stableId: "github:alice-chen",
    name: "Alice Chen",
    identitySummaryZh: "专注 agent runtime 的开源构建者",
    evidenceSummaryZh: "创建相关 repo 并持续维护",
    sourceUrlsJson: ["https://github.com/alice-chen"],
    githubUrl: "https://github.com/alice-chen",
    scholarUrl: null,
    linkedinUrl: null,
    xUrl: null,
    homepageUrl: "https://alice.example.com",
    email: "alice@example.com",
    organizationNamesRaw: ["OpenAI"],
    schoolNamesRaw: null,
    labNamesRaw: null,
    bioSnippetsRaw: null,
    founderHistoryRaw: null,
    datasetVersionId: "dataset-active",
    ...overrides,
  };
}

function createGitHubEvent() {
  return {
    stableId: "event:github:vox-agent",
    datasetVersionId: "dataset-active",
    sourceType: "github",
    eventTag: "AI Agent",
    eventHighlightZh: "浏览器 agent 执行框架。",
    eventTitleZh: "vox-agent",
    eventDetailSummaryZh: null,
    relatedRepoCount: 1,
    sourceLinksJson: [{ label: "GitHub", url: "https://github.com/example/vox-agent" }],
    projectLinks: [
      {
        project: {
          repoName: "example/vox-agent",
          repoUrl: "https://github.com/example/vox-agent",
          repoDescriptionRaw: "Browser automation runtime for agents",
          readmeExcerptRaw: "Tool-use browser workflow for long-running tasks",
        },
      },
    ],
    paperLinks: [],
  };
}

function createArxivEvent() {
  return {
    stableId: "event:arxiv:agent-pipeline",
    datasetVersionId: "dataset-active",
    sourceType: "arxiv",
    eventTag: "Research Infra",
    eventHighlightZh: "这是一条 fallback 高亮。",
    eventTitleZh: "Agent Pipeline",
    eventDetailSummaryZh: null,
    relatedRepoCount: 0,
    sourceLinksJson: [{ label: "Paper", url: "https://arxiv.org/abs/2604.12345" }],
    projectLinks: [],
    paperLinks: [
      {
        paper: {
          paperTitle: "Agent Pipeline: A Modular Workflow Runtime",
          paperUrl: "https://arxiv.org/abs/2604.12345",
          abstractRaw: "We present a modular workflow runtime system for evaluation and agent execution.",
          pdfTextRaw: null,
          codeUrl: null,
        },
      },
    ],
  };
}

function createKickstarterEvent() {
  return {
    stableId: "event:kickstarter:orbital-coder",
    datasetVersionId: "dataset-active",
    sourceType: "kickstarter",
    eventTag: "Coding Agent",
    eventHighlightZh: "一个面向开发者工具场景的众筹项目。",
    eventTitleZh: "Orbital Coder",
    eventDetailSummaryZh: null,
    relatedRepoCount: 0,
    sourceLinksJson: [{ label: "Kickstarter", url: "https://www.kickstarter.com/projects/example/orbital-coder" }],
    projectLinks: [],
    paperLinks: [],
  };
}

describe("getPipelineData", () => {
  beforeEach(() => {
    ensureActiveDatasetMock.mockReset();
    prismaMock.pipelineEntry.findMany.mockReset();
    prismaMock.person.findMany.mockReset();
    prismaMock.event.findMany.mockReset();

    ensureActiveDatasetMock.mockResolvedValue({ id: "dataset-active" });
  });

  it("builds featuredItem for GitHub entries from the linked project", async () => {
    prismaMock.pipelineEntry.findMany.mockResolvedValue([createPipelineEntry()]);
    prismaMock.person.findMany.mockResolvedValue([createPerson()]);
    prismaMock.event.findMany.mockResolvedValue([createGitHubEvent()]);

    const entries = await getPipelineData();

    expect(entries[0]?.featuredItem).toEqual({
      title: "example/vox-agent",
      url: "https://github.com/example/vox-agent",
      introZh: "用于浏览器工作流的 agent 执行循环",
    });
    expect(entries[0]?.originalCardHref).toBe("/github?event=event%3Agithub%3Avox-agent");
  });

  it("builds featuredItem for arXiv entries from the linked paper", async () => {
    prismaMock.pipelineEntry.findMany.mockResolvedValue([
      createPipelineEntry({
        savedFromEventStableId: "event:arxiv:agent-pipeline",
        savedFromEventTitle: "Agent Pipeline",
      }),
    ]);
    prismaMock.person.findMany.mockResolvedValue([createPerson()]);
    prismaMock.event.findMany.mockResolvedValue([createArxivEvent()]);

    const entries = await getPipelineData();

    expect(entries[0]?.featuredItem?.title).toBe("Agent Pipeline: A Modular Workflow Runtime");
    expect(entries[0]?.featuredItem?.url).toBe("https://arxiv.org/abs/2604.12345");
    expect(entries[0]?.featuredItem?.introZh).toBeTruthy();
    expect(entries[0]?.featuredItem?.introZh).not.toBe("这是一条 fallback 高亮。");
    expect(entries[0]?.originalCardHref).toBe("/arxiv?event=event%3Aarxiv%3Aagent-pipeline");
  });

  it("falls back to the source link when the event has no project or paper", async () => {
    prismaMock.pipelineEntry.findMany.mockResolvedValue([
      createPipelineEntry({
        savedFromEventStableId: "event:kickstarter:orbital-coder",
        savedFromEventTitle: "Orbital Coder",
      }),
    ]);
    prismaMock.person.findMany.mockResolvedValue([createPerson()]);
    prismaMock.event.findMany.mockResolvedValue([createKickstarterEvent()]);

    const entries = await getPipelineData();

    expect(entries[0]?.featuredItem).toEqual({
      title: "Orbital Coder",
      url: "https://www.kickstarter.com/projects/example/orbital-coder",
      introZh: "一个面向开发者工具场景的众筹项目。",
    });
    expect(entries[0]?.originalCardHref).toBe("/kickstarter?event=event%3Akickstarter%3Aorbital-coder");
  });
});
