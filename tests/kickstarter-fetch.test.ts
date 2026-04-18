import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getTavilyApiKeyMock } = vi.hoisted(() => ({
  getTavilyApiKeyMock: vi.fn(),
}));

vi.mock("@/lib/runtime-settings", () => ({
  getTavilyApiKey: getTavilyApiKeyMock,
}));

import { fetchKickstarterCampaigns } from "@/lib/sources/kickstarter";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("fetchKickstarterCampaigns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T12:00:00.000Z"));
    getTavilyApiKeyMock.mockReset();
    getTavilyApiKeyMock.mockResolvedValue("tvly-test");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("backfills missing started dates from an exact campaign lookup and timestamps refresh time", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "https://api.tavily.com/search") {
        return new Response("", { status: 404 });
      }

      const body = JSON.parse(String(init?.body ?? "{}"));
      const query = String(body.query ?? "");

      if (query === '"https://www.kickstarter.com/projects/ainoon/ainoon-ai-smart-glasses-that-actually-help-you-instantly"') {
        return jsonResponse({
          results: [
            {
              title: "AInoon: AI Smart Glasses That Actually Help You — Instantly",
              url: "https://www.kickstarter.com/projects/ainoon/ainoon-ai-smart-glasses-that-actually-help-you-instantly",
              raw_content:
                "AInoon is raising funds for AInoon: AI Smart Glasses That Actually Help You — Instantly on Kickstarter! " +
                "Funding period Apr 1 2026 - Apr 30 2026 (29 days). $95,000 pledged of $20,000 goal 800 backers 11 days left.",
              score: 0.98,
            },
          ],
        });
      }

      if (!query.includes("camera Kickstarter")) {
        return jsonResponse({ results: [] });
      }

      return jsonResponse({
        results: [
          {
            title: "AInoon: AI Smart Glasses That Actually Help You — Instantly",
            url: "https://www.kickstarter.com/projects/ainoon/ainoon-ai-smart-glasses-that-actually-help-you-instantly",
            raw_content:
              "AInoon is raising funds for AInoon: AI Smart Glasses That Actually Help You — Instantly on Kickstarter! " +
              "AI smart glasses with translation, a 12MP camera, and real-time assistance. " +
              "![Hero](https://images.example.com/ainoon.jpg)",
            score: 0.97,
          },
        ],
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const campaigns = await fetchKickstarterCampaigns(10);

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]?.campaignName).toBe("AInoon: AI Smart Glasses That Actually Help You — Instantly");
    expect(campaigns[0]?.collectedAt.toISOString()).toBe("2026-04-18T12:00:00.000Z");
    expect(campaigns[0]?.startedAt?.toISOString()).toContain("2026-04-01");
    expect(campaigns[0]?.imageUrl).toBe("https://images.example.com/ainoon.jpg");
  });
});
