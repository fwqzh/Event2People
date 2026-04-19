import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sources/kickstarter", () => ({
  fetchKickstarterCampaigns: vi.fn(),
}));

import { loadKickstarterCampaignsForRefresh } from "@/lib/refresh";
import { fetchKickstarterCampaigns } from "@/lib/sources/kickstarter";

function createLiveCampaign(overrides: Partial<Awaited<ReturnType<typeof fetchKickstarterCampaigns>>[number]> = {}) {
  return {
    campaignName: "AInoon AI Smart Glasses",
    campaignUrl: "https://www.kickstarter.com/projects/ainoon/ainoon-ai-smart-glasses-that-actually-help-you-instantly",
    creatorName: "AInoon",
    creatorUrl: null,
    startedAt: null,
    startedLabel: null,
    summaryRaw: "AI smart glasses with camera and translation.",
    pledgedAmount: null,
    pledgedLabel: "",
    goalAmount: null,
    goalLabel: "",
    backersCount: null,
    backersLabel: "",
    statusLabel: "Unknown",
    daysLeftLabel: null,
    isLive: false,
    collectedAt: new Date("2026-04-06T00:00:00Z"),
    searchRelevance: 12,
    ...overrides,
  };
}

function createFallbackEvent(options: {
  stableId: string;
  title: string;
  url: string;
  displayRank: number;
  personStableId: string;
  personName: string;
  eventHighlightZh?: string;
  eventDetailSummaryZh?: string;
  metricsJson?: Array<{ label: string; value: string }>;
  publishedAt?: Date;
  timePrimary?: Date;
}) {
  return {
    stableId: options.stableId,
    sourceType: "kickstarter",
    eventType: "activity_spike",
    eventTag: "AI Agent",
    eventTagConfidence: 0.88,
    eventTitleZh: options.title,
    eventHighlightZh: options.eventHighlightZh ?? `${options.title} highlight`,
    eventDetailSummaryZh: options.eventDetailSummaryZh ?? `${options.title} detail`,
    timePrimary: options.timePrimary ?? new Date("2026-04-05T00:00:00Z"),
    metricsJson: options.metricsJson ?? [{ label: "Pledged", value: "$120,000" }],
    sourceLinksJson: [{ label: "Kickstarter", url: options.url }],
    peopleDetectionStatus: "partial",
    displayRank: options.displayRank,
    relatedRepoCount: 0,
    relatedPaperCount: 0,
    datasetVersion: {
      publishedAt: options.publishedAt ?? new Date("2026-04-05T00:00:00Z"),
    },
    personLinks: [
      {
        position: 0,
        person: {
          stableId: options.personStableId,
          name: options.personName,
          identitySummaryZh: "Kickstarter Creator · 众筹发起人",
          evidenceSummaryZh: `发起 Kickstarter 项目《${options.title}》`,
          sourceUrlsJson: [options.url],
          githubUrl: null,
          scholarUrl: null,
          linkedinUrl: null,
          xUrl: null,
          homepageUrl: null,
          email: null,
          organizationNamesRaw: null,
          schoolNamesRaw: null,
          labNamesRaw: null,
          bioSnippetsRaw: null,
          founderHistoryRaw: null,
        },
      },
    ],
  };
}

describe("refresh kickstarter fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tops up sparse live kickstarter results with recent historical campaigns", async () => {
    vi.mocked(fetchKickstarterCampaigns).mockResolvedValue([createLiveCampaign()]);

    const prisma = {
      datasetVersion: {},
      event: {
        findMany: vi.fn().mockResolvedValue([
          createFallbackEvent({
            stableId: "event:kickstarter:dont-starve-board-game",
            title: "Container, GRUNTZ, and Triangulation",
            url: "https://www.kickstarter.com/projects/dontstarve/dont-starve-the-board-game",
            displayRank: 1,
            personStableId: "kickstarter:klei",
            personName: "Klei",
            eventHighlightZh: "桌游组合众筹",
            eventDetailSummaryZh: "三款策略桌游组合众筹，已筹资111万美元，剩余11天",
          }),
          createFallbackEvent({
            stableId: "event:kickstarter:note-pod-p1",
            title: "ANYPIN Note Pod P1",
            url: "https://www.kickstarter.com/projects/153372252/anypin-next-gen-wi-fi-wearable-ai-voice-recorder",
            displayRank: 2,
            personStableId: "kickstarter:anypin",
            personName: "ANYPIN",
            metricsJson: [
              { label: "Pledged", value: "$120,000" },
              { label: "Started", value: "2026-03-28" },
            ],
            publishedAt: new Date("2026-04-08T00:00:00Z"),
          }),
          createFallbackEvent({
            stableId: "event:kickstarter:rokid-glasses",
            title: "Rokid Glasses",
            url: "https://www.kickstarter.com/projects/rokid/new-rokid-glassesworlds-lighest-full-function-ai-glasses",
            displayRank: 3,
            personStableId: "kickstarter:rokid-team",
            personName: "Rokid Team",
            metricsJson: [
              { label: "Pledged", value: "$98,000" },
              { label: "Started", value: "2026-04-02" },
            ],
            publishedAt: new Date("2026-04-09T00:00:00Z"),
          }),
          createFallbackEvent({
            stableId: "event:kickstarter:tiny-fundraiser",
            title: "Tiny Fundraiser",
            url: "https://www.kickstarter.com/projects/tiny/tiny-fundraiser",
            displayRank: 4,
            personStableId: "kickstarter:tiny",
            personName: "Tiny",
            metricsJson: [
              { label: "Pledged", value: "$9,500" },
              { label: "Started", value: "2026-04-04" },
            ],
            publishedAt: new Date("2026-04-10T00:00:00Z"),
          }),
        ]),
      },
    };

    const result = await loadKickstarterCampaignsForRefresh(prisma as never, 3);

    expect(result.events).toHaveLength(3);
    expect(result.events.map((event) => event.eventTitleZh)).toEqual([
      "AInoon AI Smart Glasses",
      "Rokid Glasses",
      "ANYPIN Note Pod P1",
    ]);
    expect(result.events[0]?.timePrimary.toISOString()).toBe("2026-04-06T00:00:00.000Z");
    expect(result.events.map((event) => event.displayRank)).toEqual([1, 2, 3]);
    expect(result.people.map((person) => person.name)).toEqual(["AInoon", "Rokid Team", "ANYPIN"]);
    expect(result.warning).toContain("补齐到 3 个");
    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 15,
        where: expect.objectContaining({
          sourceType: "kickstarter",
        }),
      }),
    );
  });

  it("skips fallback kickstarter campaigns below the minimum pledged threshold", async () => {
    vi.mocked(fetchKickstarterCampaigns).mockResolvedValue([]);

    const prisma = {
      datasetVersion: {},
      event: {
        findMany: vi.fn().mockResolvedValue([
          createFallbackEvent({
            stableId: "event:kickstarter:below-threshold",
            title: "Below Threshold",
            url: "https://www.kickstarter.com/projects/example/below-threshold",
            displayRank: 1,
            personStableId: "kickstarter:below",
            personName: "Below",
            metricsJson: [
              { label: "Pledged", value: "$8,500" },
              { label: "Started", value: "2026-04-10" },
            ],
          }),
          createFallbackEvent({
            stableId: "event:kickstarter:above-threshold",
            title: "Above Threshold",
            url: "https://www.kickstarter.com/projects/example/above-threshold",
            displayRank: 2,
            personStableId: "kickstarter:above",
            personName: "Above",
            metricsJson: [
              { label: "Pledged", value: "$12,000" },
              { label: "Started", value: "2026-04-09" },
            ],
          }),
        ]),
      },
    };

    const result = await loadKickstarterCampaignsForRefresh(prisma as never, 3);

    expect(result.events.map((event) => event.eventTitleZh)).toEqual(["Above Threshold"]);
    expect(result.people.map((person) => person.name)).toEqual(["Above"]);
  });

  it("keeps all live campaigns when the refresh already has enough recent results", async () => {
    vi.mocked(fetchKickstarterCampaigns).mockResolvedValue(
      Array.from({ length: 12 }, (_, index) =>
        createLiveCampaign({
          campaignName: `Live Project ${index + 1}`,
          campaignUrl: `https://www.kickstarter.com/projects/live/live-project-${index + 1}`,
          creatorName: `Creator ${index + 1}`,
          startedAt: new Date(`2026-04-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
          startedLabel: `2026-04-${String(index + 1).padStart(2, "0")}`,
          isLive: true,
          statusLabel: "Live",
          daysLeftLabel: "10 days",
        }),
      ),
    );

    const prisma = {
      datasetVersion: {},
      event: {
        findMany: vi.fn(),
      },
    };

    const result = await loadKickstarterCampaignsForRefresh(prisma as never, 12);

    expect(result.events).toHaveLength(12);
    expect(result.events[0]?.eventTitleZh).toBe("Live Project 1");
    expect(result.warning).toBeNull();
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it("falls back to recent historical campaigns when live fetch returns nothing", async () => {
    vi.mocked(fetchKickstarterCampaigns).mockResolvedValue([]);

    const prisma = {
      datasetVersion: {},
      event: {
        findMany: vi.fn().mockResolvedValue([
          createFallbackEvent({
            stableId: "event:kickstarter:note-pod-p1",
            title: "ANYPIN Note Pod P1",
            url: "https://www.kickstarter.com/projects/153372252/anypin-next-gen-wi-fi-wearable-ai-voice-recorder",
            displayRank: 1,
            personStableId: "kickstarter:anypin",
            personName: "ANYPIN",
          }),
        ]),
      },
    };

    const result = await loadKickstarterCampaignsForRefresh(prisma as never, 3);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.eventTitleZh).toBe("ANYPIN Note Pod P1");
    expect(result.warning).toContain("最近历史数据");
  });
});
