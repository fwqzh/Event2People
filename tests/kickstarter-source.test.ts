import { describe, expect, it } from "vitest";

import {
  coalesceKickstarterCampaigns,
  normalizeKickstarterCampaignUrl,
  parseKickstarterCampaignCandidate,
} from "@/lib/sources/kickstarter";

describe("kickstarter source helpers", () => {
  it("keeps only canonical kickstarter campaign urls", () => {
    expect(
      normalizeKickstarterCampaignUrl("https://www.kickstarter.com/projects/lenaortiz/orbital-coder?ref=discovery"),
    ).toBe("https://www.kickstarter.com/projects/lenaortiz/orbital-coder");
    expect(
      normalizeKickstarterCampaignUrl("https://www.kickstarter.com/projects/lenaortiz/orbital-coder/description"),
    ).toBe("https://www.kickstarter.com/projects/lenaortiz/orbital-coder");
    expect(
      normalizeKickstarterCampaignUrl("https://www.kickstarter.com/projects/lenaortiz/orbital-coder/posts/1234567"),
    ).toBe("");
    expect(normalizeKickstarterCampaignUrl("https://www.kickstarter.com/discover")).toBe("");
  });

  it("parses consumer electronics metrics from a kickstarter search result", () => {
    const candidate = parseKickstarterCampaignCandidate({
      title: "Echo Clip by Mei Lin — Kickstarter",
      url: "https://www.kickstarter.com/projects/meilin/echo-clip?ref=discovery",
      content:
        "Funding period Mar 18 2026 - Apr 12 2026 (25 days). Echo Clip is an AI voice recorder with on-device transcription, speaker playback, and microphone array. $240,000 pledged of $50,000 goal 3,200 backers 12 days to go.",
      score: 0.95,
    });

    expect(candidate).toBeTruthy();
    expect(candidate?.campaignName).toBe("Echo Clip");
    expect(candidate?.creatorName).toBe("Mei Lin");
    expect(candidate?.pledgedAmount).toBe(240000);
    expect(candidate?.goalAmount).toBe(50000);
    expect(candidate?.backersCount).toBe(3200);
    expect(candidate?.startedLabel).toBe("Mar 18 2026");
    expect(candidate?.startedAt?.toISOString()).toContain("2026-03-18");
    expect(candidate?.daysLeftLabel).toBe("12 days");
    expect(candidate?.isLive).toBe(true);
  });

  it("accepts recent ai hardware and consumer electronics projects", () => {
    const candidate = parseKickstarterCampaignCandidate({
      title: "Nova Sphere — Give Your AI Assistant a Body by Nova Labs - Kickstarter",
      url: "https://www.kickstarter.com/projects/novalabs/nova-sphere-give-your-ai-assistant-a-body",
      content:
        "Nova Labs is raising funds for Nova Sphere on Kickstarter! An AI companion device with voice control, camera, speaker, and on-device AI. $185,000 pledged of $40,000 goal 1,240 backers 9 days left.",
      score: 0.91,
    });

    expect(candidate).toBeTruthy();
    expect(candidate?.campaignName).toBe("Nova Sphere — Give Your AI Assistant a Body");
    expect(candidate?.pledgedAmount).toBe(185000);
    expect(candidate?.backersCount).toBe(1240);
    expect(candidate?.isLive).toBe(true);
  });

  it("filters out games and entertainment projects", () => {
    const candidate = parseKickstarterCampaignCandidate({
      title: "Realm of Reckoning by IV Studios - Kickstarter",
      url: "https://www.kickstarter.com/projects/ivstudios/realm-of-reckoning",
      content:
        "IV Studios is raising funds for Realm of Reckoning on Kickstarter! A new fantasy board game with miniatures. $672,875 pledged of $50,000 goal 5,824 backers 11 days left.",
      score: 0.94,
    });

    expect(candidate).toBeNull();
  });

  it("deduplicates campaigns and sorts by pledged, then backers, live status, and recency", () => {
    const now = new Date("2026-04-06T12:00:00.000Z");
    const older = new Date("2026-04-05T12:00:00.000Z");
    const campaigns = [
      {
        campaignName: "Orbital Coder",
        campaignUrl: "https://www.kickstarter.com/projects/lenaortiz/orbital-coder",
        creatorName: "Lena Ortiz",
        creatorUrl: null,
        startedAt: now,
        startedLabel: "2026-04-06",
        summaryRaw: "AI agent devtool",
        pledgedAmount: 240000,
        pledgedLabel: "$240,000",
        goalAmount: 50000,
        goalLabel: "$50,000",
        backersCount: 3200,
        backersLabel: "3,200",
        statusLabel: "Live",
        daysLeftLabel: "12 days",
        isLive: true,
        collectedAt: now,
        searchRelevance: 4,
      },
      {
        campaignName: "Orbital Coder",
        campaignUrl: "https://www.kickstarter.com/projects/lenaortiz/orbital-coder",
        creatorName: "Lena Ortiz",
        creatorUrl: null,
        startedAt: older,
        startedLabel: "2026-04-05",
        summaryRaw: "",
        pledgedAmount: 210000,
        pledgedLabel: "$210,000",
        goalAmount: 50000,
        goalLabel: "$50,000",
        backersCount: 2900,
        backersLabel: "2,900",
        statusLabel: "Live",
        daysLeftLabel: "12 days",
        isLive: true,
        collectedAt: older,
        searchRelevance: 3,
      },
      {
        campaignName: "Atlas Arm",
        campaignUrl: "https://www.kickstarter.com/projects/omar/atlas-arm",
        creatorName: "Omar",
        creatorUrl: null,
        startedAt: now,
        startedLabel: "2026-04-06",
        summaryRaw: "robotics hardware",
        pledgedAmount: 180000,
        pledgedLabel: "$180,000",
        goalAmount: 70000,
        goalLabel: "$70,000",
        backersCount: 1800,
        backersLabel: "1,800",
        statusLabel: "Live",
        daysLeftLabel: "6 days",
        isLive: true,
        collectedAt: now,
        searchRelevance: 3,
      },
      {
        campaignName: "Echo Clip",
        campaignUrl: "https://www.kickstarter.com/projects/mei/echo-clip",
        creatorName: "Mei",
        creatorUrl: null,
        startedAt: older,
        startedLabel: "2026-04-05",
        summaryRaw: "voice device",
        pledgedAmount: 180000,
        pledgedLabel: "$180,000",
        goalAmount: 40000,
        goalLabel: "$40,000",
        backersCount: 1900,
        backersLabel: "1,900",
        statusLabel: "Ended",
        daysLeftLabel: null,
        isLive: false,
        collectedAt: older,
        searchRelevance: 2,
      },
      {
        campaignName: "FramePilot",
        campaignUrl: "https://www.kickstarter.com/projects/jonah/framepilot",
        creatorName: "Jonah",
        creatorUrl: null,
        startedAt: now,
        startedLabel: "2026-04-06",
        summaryRaw: "video camera",
        pledgedAmount: null,
        pledgedLabel: "",
        goalAmount: 40000,
        goalLabel: "$40,000",
        backersCount: 2500,
        backersLabel: "2,500",
        statusLabel: "Live",
        daysLeftLabel: "5 days",
        isLive: true,
        collectedAt: now,
        searchRelevance: 2,
      },
    ];

    const ranked = coalesceKickstarterCampaigns(campaigns, 10);

    expect(ranked).toHaveLength(4);
    expect(ranked.map((campaign) => campaign.campaignName)).toEqual([
      "Orbital Coder",
      "Echo Clip",
      "Atlas Arm",
      "FramePilot",
    ]);
  });
});
