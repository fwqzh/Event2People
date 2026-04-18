import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, ensureActiveDatasetMock } = vi.hoisted(() => ({
  prismaMock: {
    pipelineEntry: {
      findMany: vi.fn(),
    },
    datasetVersion: {
      findFirst: vi.fn(),
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
  parseMetrics: (value: unknown) => (Array.isArray(value) ? value : []),
}));

import { getKickstarterPageData } from "@/lib/data";

function createKickstarterEvent(overrides: Record<string, unknown> = {}) {
  return {
    stableId: "event:kickstarter:sample",
    datasetVersionId: "dataset-active",
    sourceType: "kickstarter",
    eventType: "activity_spike",
    eventTag: "AI Agent",
    eventTagConfidence: 0.88,
    eventTitleZh: "Sample Kickstarter",
    eventHighlightZh: "一个众筹项目。",
    eventDetailSummaryZh: "一个众筹项目。",
    timePrimary: new Date("2026-04-10T09:00:00.000Z"),
    metricsJson: [{ label: "Pledged", value: "$10,000" }],
    sourceLinksJson: [{ label: "Kickstarter", url: "https://www.kickstarter.com/projects/example/sample" }],
    peopleDetectionStatus: "missing",
    displayRank: 1,
    relatedRepoCount: 0,
    relatedPaperCount: 0,
    projectLinks: [],
    paperLinks: [],
    personLinks: [],
    ...overrides,
  };
}

describe("getKickstarterPageData", () => {
  beforeEach(() => {
    ensureActiveDatasetMock.mockReset();
    prismaMock.pipelineEntry.findMany.mockReset();
    prismaMock.datasetVersion.findFirst.mockReset();
    prismaMock.event.findMany.mockReset();

    ensureActiveDatasetMock.mockResolvedValue({ id: "dataset-active" });
    prismaMock.pipelineEntry.findMany.mockResolvedValue([]);
    prismaMock.datasetVersion.findFirst.mockResolvedValue(null);
  });

  it("orders kickstarter cards by started date before refresh recency and pledged amount", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      createKickstarterEvent({
        stableId: "event:kickstarter:older-huge",
        eventTitleZh: "Older Huge",
        timePrimary: new Date("2026-04-18T09:00:00.000Z"),
        metricsJson: [
          { label: "Pledged", value: "$500,000" },
          { label: "Started", value: "2026-02-01" },
        ],
        displayRank: 1,
      }),
      createKickstarterEvent({
        stableId: "event:kickstarter:newer-modest",
        eventTitleZh: "Newer Modest",
        timePrimary: new Date("2026-04-01T09:00:00.000Z"),
        metricsJson: [
          { label: "Pledged", value: "$10,000" },
          { label: "Started", value: "2026-04-15" },
        ],
        displayRank: 2,
      }),
      createKickstarterEvent({
        stableId: "event:kickstarter:newer-stronger",
        eventTitleZh: "Newer Stronger",
        timePrimary: new Date("2026-04-01T09:00:00.000Z"),
        metricsJson: [
          { label: "Pledged", value: "$20,000" },
          { label: "Started", value: "2026-04-15" },
        ],
        displayRank: 3,
      }),
    ]);

    const data = await getKickstarterPageData();

    expect(data.kickstarterEvents.map((event) => event.eventTitleZh)).toEqual([
      "Newer Stronger",
      "Newer Modest",
      "Older Huge",
    ]);
    expect(data.kickstarterEvents.map((event) => event.displayRank)).toEqual([1, 2, 3]);
  });
});
