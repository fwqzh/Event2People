import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { getHomepageData, getKickstarterPageData } from "@/lib/data";

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T12:00:00.000Z"));
    ensureActiveDatasetMock.mockReset();
    prismaMock.pipelineEntry.findMany.mockReset();
    prismaMock.datasetVersion.findFirst.mockReset();
    prismaMock.event.findMany.mockReset();

    ensureActiveDatasetMock.mockResolvedValue({ id: "dataset-active" });
    prismaMock.pipelineEntry.findMany.mockResolvedValue([]);
    prismaMock.datasetVersion.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the dedicated kickstarter pool sorted by pledged amount within the 90-day cap", async () => {
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
          { label: "Started", value: "2026-04-16" },
        ],
        displayRank: 2,
      }),
      createKickstarterEvent({
        stableId: "event:kickstarter:newer-stronger",
        eventTitleZh: "Newer Stronger",
        timePrimary: new Date("2026-04-01T09:00:00.000Z"),
        metricsJson: [
          { label: "Pledged", value: "$20,000" },
          { label: "Started", value: "2026-04-17" },
        ],
        displayRank: 3,
      }),
      createKickstarterEvent({
        stableId: "event:kickstarter:no-started",
        eventTitleZh: "No Started",
        timePrimary: new Date("2026-04-18T09:00:00.000Z"),
        metricsJson: [{ label: "Pledged", value: "$999,000" }],
        displayRank: 4,
      }),
      createKickstarterEvent({
        stableId: "event:kickstarter:too-old",
        eventTitleZh: "Too Old",
        timePrimary: new Date("2026-04-18T09:00:00.000Z"),
        metricsJson: [
          { label: "Pledged", value: "$888,000" },
          { label: "Started", value: "2025-12-01" },
        ],
        displayRank: 5,
      }),
    ]);

    const data = await getKickstarterPageData();

    expect(data.kickstarterEvents.map((event) => event.eventTitleZh)).toEqual([
      "Older Huge",
      "Newer Stronger",
      "Newer Modest",
    ]);
    expect(data.kickstarterEvents.map((event) => event.displayRank)).toEqual([1, 2, 3]);
  });

  it("filters low-pledged kickstarter events out of the page pool", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      createKickstarterEvent({
        stableId: "event:kickstarter:below-threshold",
        eventTitleZh: "Below Threshold",
        metricsJson: [
          { label: "Pledged", value: "$9,999" },
          { label: "Started", value: "2026-04-17" },
        ],
        displayRank: 1,
      }),
      createKickstarterEvent({
        stableId: "event:kickstarter:at-threshold",
        eventTitleZh: "At Threshold",
        metricsJson: [
          { label: "Pledged", value: "$10,000" },
          { label: "Started", value: "2026-04-16" },
        ],
        displayRank: 2,
      }),
      createKickstarterEvent({
        stableId: "event:kickstarter:unknown-pledged",
        eventTitleZh: "Unknown Pledged",
        metricsJson: [{ label: "Started", value: "2026-04-15" }],
        displayRank: 3,
      }),
    ]);

    const data = await getKickstarterPageData();

    expect(data.kickstarterEvents.map((event) => event.eventTitleZh)).toEqual(["At Threshold", "Unknown Pledged"]);
  });

  it("keeps older kickstarter events within 90 days in the page pool so the client can backfill filtered views", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      createKickstarterEvent({
        stableId: "event:kickstarter:recent-big",
        eventTitleZh: "Recent Big",
        metricsJson: [
          { label: "Pledged", value: "$90,000" },
          { label: "Started", value: "2026-04-12" },
        ],
        displayRank: 1,
      }),
      createKickstarterEvent({
        stableId: "event:kickstarter:fourteen-day-small",
        eventTitleZh: "Fourteen Day Small",
        metricsJson: [
          { label: "Pledged", value: "$10,000" },
          { label: "Started", value: "2026-04-07" },
        ],
        displayRank: 2,
      }),
      createKickstarterEvent({
        stableId: "event:kickstarter:thirty-day-huge",
        eventTitleZh: "Thirty Day Huge",
        metricsJson: [
          { label: "Pledged", value: "$999,000" },
          { label: "Started", value: "2026-03-29" },
        ],
        displayRank: 3,
      }),
      createKickstarterEvent({
        stableId: "event:kickstarter:sixty-day-small",
        eventTitleZh: "Sixty Day Small",
        metricsJson: [
          { label: "Pledged", value: "$75,000" },
          { label: "Started", value: "2026-03-08" },
        ],
        displayRank: 4,
      }),
      createKickstarterEvent({
        stableId: "event:kickstarter:too-old",
        eventTitleZh: "Too Old",
        metricsJson: [
          { label: "Pledged", value: "$900,000" },
          { label: "Started", value: "2025-12-01" },
        ],
        displayRank: 3,
      }),
    ]);

    const data = await getKickstarterPageData();

    expect(data.kickstarterEvents.map((event) => event.eventTitleZh)).toEqual([
      "Thirty Day Huge",
      "Recent Big",
      "Sixty Day Small",
      "Fourteen Day Small",
    ]);
  });

  it("returns a larger kickstarter pool for the dedicated page while keeping the homepage at ten", async () => {
    prismaMock.event.findMany.mockResolvedValue(
      Array.from({ length: 60 }, (_, index) => {
        const startedAt = new Date(Date.UTC(2026, 3, 18 - (index % 7)));

        return createKickstarterEvent({
          stableId: `event:kickstarter:sample-${index + 1}`,
          eventTitleZh: `Sample ${index + 1}`,
          timePrimary: new Date(`2026-04-${String((index % 28) + 1).padStart(2, "0")}T09:00:00.000Z`),
          metricsJson: [
            { label: "Pledged", value: `$${60 - index},000` },
            { label: "Started", value: startedAt.toISOString().slice(0, 10) },
          ],
          displayRank: index + 1,
        });
      }),
    );

    const [homepageData, kickstarterData] = await Promise.all([getHomepageData(), getKickstarterPageData()]);

    expect(homepageData.kickstarterEvents).toHaveLength(10);
    expect(kickstarterData.kickstarterEvents).toHaveLength(50);
    expect(kickstarterData.kickstarterEvents[0]?.eventTitleZh).toBe("Sample 1");
    expect(kickstarterData.kickstarterEvents.at(-1)?.eventTitleZh).toBe("Sample 50");
  });
});
