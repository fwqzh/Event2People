import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getTavilyApiKeyMock } = vi.hoisted(() => ({
  getTavilyApiKeyMock: vi.fn(),
}));
const { playwrightLaunchMock } = vi.hoisted(() => ({
  playwrightLaunchMock: vi.fn(),
}));

vi.mock("@/lib/runtime-settings", () => ({
  getTavilyApiKey: getTavilyApiKeyMock,
}));
vi.mock("playwright", () => ({
  chromium: {
    launch: playwrightLaunchMock,
  },
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
    playwrightLaunchMock.mockReset();
    playwrightLaunchMock.mockResolvedValue({
      newContext: vi.fn(async () => ({
        addInitScript: vi.fn(async () => undefined),
        newPage: vi.fn(async () => ({
          setDefaultNavigationTimeout: vi.fn(),
          goto: vi.fn(async () => ({ ok: () => true })),
          waitForTimeout: vi.fn(async () => undefined),
          title: vi.fn(async () => "Discover » Technology » Newest — Kickstarter"),
          content: vi.fn(async () => "<main></main>"),
          locator: vi.fn(() => ({
            innerText: vi.fn(async () => ""),
          })),
          close: vi.fn(async () => undefined),
        })),
        close: vi.fn(async () => undefined),
      })),
      close: vi.fn(async () => undefined),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs both week and month searches, then backfills missing started dates from an exact campaign lookup", async () => {
    const searchBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "https://api.tavily.com/search") {
        return new Response("", { status: 404 });
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      searchBodies.push(body);
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

      if (body.time_range !== "week") {
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

    const cameraSearches = searchBodies.filter((body) => String(body.query ?? "").includes("camera Kickstarter"));
    expect(cameraSearches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          time_range: "week",
          max_results: 12,
        }),
        expect.objectContaining({
          time_range: "month",
          max_results: 8,
        }),
      ]),
    );
  });

  it("re-ranks recent projects after supplement lookups instead of cutting to the final limit too early", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "https://api.tavily.com/search") {
        return new Response("", { status: 404 });
      }

      const body = JSON.parse(String(init?.body ?? "{}"));
      const query = String(body.query ?? "");

      if (query === '"https://www.kickstarter.com/projects/freshlab/fresh-band-ai-wrist-coach"') {
        return jsonResponse({
          results: [
            {
              title: "Fresh Band AI Wrist Coach",
              url: "https://www.kickstarter.com/projects/freshlab/fresh-band-ai-wrist-coach",
              raw_content:
                "FreshLab is raising funds for Fresh Band AI Wrist Coach on Kickstarter! " +
                "Funding period Apr 17 2026 - May 16 2026 (29 days). $32,000 pledged of $12,000 goal 410 backers 18 days left.",
              score: 0.93,
            },
          ],
        });
      }

      if (!query.includes("camera Kickstarter") || body.time_range !== "week") {
        return jsonResponse({ results: [] });
      }

      return jsonResponse({
        results: [
          {
            title: "Legacy Lens AI Cam",
            url: "https://www.kickstarter.com/projects/legacy/legacy-lens-ai-cam",
            raw_content:
              "Legacy is raising funds for Legacy Lens AI Cam on Kickstarter! " +
              "Funding period Mar 1 2026 - Mar 31 2026 (30 days). $280,000 pledged of $20,000 goal 2,200 backers 5 days left. " +
              "![Hero](https://images.example.com/legacy.jpg)",
            score: 0.99,
          },
          {
            title: "Fresh Band AI Wrist Coach",
            url: "https://www.kickstarter.com/projects/freshlab/fresh-band-ai-wrist-coach",
            raw_content:
              "FreshLab is raising funds for Fresh Band AI Wrist Coach on Kickstarter! " +
              "An AI wearable coach with haptics, motion sensing, and live guidance for workouts. " +
              "![Hero](https://images.example.com/fresh.jpg)",
            score: 0.92,
          },
        ],
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const campaigns = await fetchKickstarterCampaigns(1);

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]?.campaignName).toBe("Fresh Band AI Wrist Coach");
    expect(campaigns[0]?.startedAt?.toISOString()).toContain("2026-04-17");
  });

  it("runs extended AI discovery searches and combines content with raw content to recover recent launch dates", async () => {
    const searchBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "https://api.tavily.com/search") {
        return new Response("", { status: 404 });
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      searchBodies.push(body);
      const query = String(body.query ?? "");

      if (!query.includes('"ai glasses" Kickstarter') || body.time_range !== "year") {
        return jsonResponse({ results: [] });
      }

      return jsonResponse({
        results: [
          {
            title: "World's First Titanium AI Glasses by Dymesty - Kickstarter",
            url: "https://www.kickstarter.com/projects/dymesty/dymesty-ai-glasses-when-sleek-design-meets-ai",
            content:
              "# Dymesty AI Glasses: World's First Titanium AI Glasses by Dymesty — Kickstarter " +
              "All-Day Battery | AI Translation | Efficiency APP. " +
              "664 backers pledged $193,192 to help bring this project to life. Last updated March 19, 2026.",
            raw_content:
              "# Dymesty AI Glasses: World's First Titanium AI Glasses by Dymesty — Kickstarter " +
              "### Funding period Mar 24 2026 - May 8 2026 (45 days).",
            score: 0.99,
          },
          {
            title: "Rokid Glasses, World's Lightest Full-function AI&AR Glasses",
            url: "https://www.kickstarter.com/projects/rokid/new-rokid-glassesworlds-lighest-full-function-ai-glasses",
            content:
              "# Rokid Glasses, World's Lightest Full-function AI&AR Glasses by Rokid Team — Kickstarter " +
              "Late pledge details. 438 backers. Estimated delivery Nov 2025.",
            raw_content:
              "# Rokid Glasses, World's Lightest Full-function AI&AR Glasses by Rokid Team — Kickstarter " +
              "### Funding period Mar 30 2026 - May 15 2026 (46 days). " +
              "$450,000 pledged of $20,000 goal 2,000 backers.",
            score: 0.98,
          },
        ],
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const campaigns = await fetchKickstarterCampaigns(50);

    expect(campaigns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campaignName: "World's First Titanium AI Glasses",
          campaignUrl: "https://www.kickstarter.com/projects/dymesty/dymesty-ai-glasses-when-sleek-design-meets-ai",
          startedLabel: "Mar 24 2026",
          pledgedLabel: "$193,192",
        }),
        expect.objectContaining({
          campaignName: "Rokid Glasses, World's Lightest Full-function AI&AR Glasses",
          campaignUrl: "https://www.kickstarter.com/projects/rokid/new-rokid-glassesworlds-lighest-full-function-ai-glasses",
          startedLabel: "Mar 30 2026",
          pledgedLabel: "$450,000",
        }),
      ]),
    );

    expect(
      searchBodies.some(
        (body) => String(body.query ?? "").includes('"ai glasses" Kickstarter') && body.time_range === "year" && body.max_results === 12,
      ),
    ).toBe(true);
  });

  it("drops official discover projects when pledged is below the minimum threshold", async () => {
    playwrightLaunchMock.mockResolvedValue({
      newContext: vi.fn(async () => ({
        addInitScript: vi.fn(async () => undefined),
        newPage: vi.fn(async () => {
          let currentUrl = "";

          return {
            setDefaultNavigationTimeout: vi.fn(),
            goto: vi.fn(async (url: string) => {
              currentUrl = url;
              return { ok: () => true };
            }),
            waitForTimeout: vi.fn(async () => undefined),
            title: vi.fn(async () =>
              currentUrl.includes("/discover/")
                ? "Discover » Technology » Newest — Kickstarter"
                : "DataLeakz - Data Breach Intelligence by Baris Ayarkan — Kickstarter",
            ),
            content: vi.fn(async () =>
              currentUrl.includes("/discover/")
                ? `
                    <main>
                      <a href="/projects/dataleakz/dataleakz-data-breach-intelligence-0?ref=discovery_category_newest&total_hits=57485&category_id=332">
                        DataLeakz - Data Breach Intelligence
                      </a>
                    </main>
                  `
                : `
                    <script>
                      window.__data = {
                        "project_creator_name":"Baris Ayarkan",
                        "project_current_amount_pledged_usd":0.0,
                        "project_goal_usd":10000.0,
                        "project_backers_count":0,
                        "project_launched_at":"2026-04-18T18:10:02-04:00",
                        "project_blurb":"Dataleakz is a modern breach checker, but more simple and smarter. You can search email, username, or domain and see real risk.",
                        "project_photo_full":"https://images.example.com/dataleakz.png"
                      };
                    </script>
                  `,
            ),
            locator: vi.fn(() => ({
              innerText: vi.fn(async () =>
                currentUrl.includes("/discover/")
                  ? "Technology"
                  : "Apps Raleigh, NC $0 pledged of $10,000 goal 0 backers 59 days to go " +
                    "DataLeakz - Data Breach Intelligence Dataleakz is a modern breach checker, but more simple and smarter. " +
                    "You can search email, username, or domain and see real risk.",
              ),
            })),
            close: vi.fn(async () => undefined),
          };
        }),
        close: vi.fn(async () => undefined),
      })),
      close: vi.fn(async () => undefined),
    });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ results: [] })));

    const campaigns = await fetchKickstarterCampaigns(10);

    expect(campaigns).toEqual([]);
  });

  it("expands the official discover source across multiple pages before falling back to Tavily", async () => {
    playwrightLaunchMock.mockResolvedValue({
      newContext: vi.fn(async () => ({
        addInitScript: vi.fn(async () => undefined),
        newPage: vi.fn(async () => {
          let currentUrl = "";

          return {
            setDefaultNavigationTimeout: vi.fn(),
            goto: vi.fn(async (url: string) => {
              currentUrl = url;

              if (url.includes("page=3")) {
                return { ok: () => false };
              }

              return { ok: () => true };
            }),
            waitForTimeout: vi.fn(async () => undefined),
            title: vi.fn(async () => "Discover » Technology » Newest — Kickstarter"),
            content: vi.fn(async () =>
              currentUrl.includes("page=2")
                ? `
                    <main>
                      <a href="/projects/bluetti/fridgepower?ref=discovery_category_newest&total_hits=57485&category_id=52">
                        BLUETTI FridgePower: Power Out. Fridge On.
                      </a>
                      <script type="application/json">
                        {&quot;id&quot;:2,&quot;photo&quot;:{&quot;1024x576&quot;:&quot;https://images.example.com/fridgepower.png&quot;},&quot;name&quot;:&quot;BLUETTI FridgePower: Power Out. Fridge On.&quot;,&quot;blurb&quot;:&quot;A portable cooling system and power station.&quot;,&quot;goal&quot;:50000.0,&quot;pledged&quot;:1220000.0,&quot;state&quot;:&quot;live&quot;,&quot;slug&quot;:&quot;fridgepower&quot;,&quot;currency&quot;:&quot;USD&quot;,&quot;currency_symbol&quot;:&quot;$&quot;,&quot;deadline&quot;:1778976000,&quot;launched_at&quot;:1776297600,&quot;backers_count&quot;:1093,&quot;creator&quot;:{&quot;name&quot;:&quot;BLUETTI&quot;,&quot;urls&quot;:{&quot;web&quot;:{&quot;user&quot;:&quot;https://www.kickstarter.com/profile/bluetti&quot;}}}}
                      </script>
                    </main>
                  `
                : `
                    <main>
                      <a href="/projects/dataleakz/dataleakz-data-breach-intelligence-0?ref=discovery_category_newest&total_hits=57485&category_id=332">
                        DataLeakz - Data Breach Intelligence
                      </a>
                      <script type="application/json">
                        {&quot;id&quot;:1,&quot;photo&quot;:{&quot;1024x576&quot;:&quot;https://images.example.com/dataleakz.png&quot;},&quot;name&quot;:&quot;DataLeakz - Data Breach Intelligence&quot;,&quot;blurb&quot;:&quot;A breach checker app.&quot;,&quot;goal&quot;:10000.0,&quot;pledged&quot;:0.0,&quot;state&quot;:&quot;live&quot;,&quot;slug&quot;:&quot;dataleakz-data-breach-intelligence-0&quot;,&quot;currency&quot;:&quot;USD&quot;,&quot;currency_symbol&quot;:&quot;$&quot;,&quot;deadline&quot;:1781734202,&quot;launched_at&quot;:1776550202,&quot;backers_count&quot;:0,&quot;creator&quot;:{&quot;name&quot;:&quot;Baris Ayarkan&quot;,&quot;urls&quot;:{&quot;web&quot;:{&quot;user&quot;:&quot;https://www.kickstarter.com/profile/dataleakz&quot;}}}}
                      </script>
                    </main>
                  `,
            ),
            locator: vi.fn(() => ({
              innerText: vi.fn(async () => "Technology"),
            })),
            close: vi.fn(async () => undefined),
          };
        }),
        close: vi.fn(async () => undefined),
      })),
      close: vi.fn(async () => undefined),
    });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ results: [] })));

    const campaigns = await fetchKickstarterCampaigns(10);

    expect(campaigns).toEqual([
      expect.objectContaining({
        campaignName: "BLUETTI FridgePower: Power Out. Fridge On.",
        campaignUrl: "https://www.kickstarter.com/projects/bluetti/fridgepower",
        startedLabel: "Apr 15 2026",
        pledgedLabel: "$1,220,000",
      }),
    ]);
  });

  it("recovers official discover links through exact-url Tavily lookups when the page lacks embedded project json", async () => {
    playwrightLaunchMock.mockResolvedValue({
      newContext: vi.fn(async () => ({
        addInitScript: vi.fn(async () => undefined),
        newPage: vi.fn(async () => {
          let currentUrl = "";

          return {
            setDefaultNavigationTimeout: vi.fn(),
            goto: vi.fn(async (url: string) => {
              currentUrl = url;

              if (url.includes("page=2")) {
                return { ok: () => false };
              }

              return { ok: () => true };
            }),
            waitForTimeout: vi.fn(async () => undefined),
            title: vi.fn(async () =>
              currentUrl.includes("/discover/")
                ? "Discover » Technology » Newest — Kickstarter"
                : "Just a moment...",
            ),
            content: vi.fn(async () =>
              `
                <main>
                  <a href="/projects/ainoon/ainoon-ai-smart-glasses-that-actually-help-you-instantly?ref=discovery_category_newest&total_hits=57485&category_id=52">
                    AInoon: AI Smart Glasses That Actually Help You — Instantly
                  </a>
                </main>
              `,
            ),
            locator: vi.fn(() => ({
              innerText: vi.fn(async () => "Technology"),
            })),
            close: vi.fn(async () => undefined),
          };
        }),
        close: vi.fn(async () => undefined),
      })),
      close: vi.fn(async () => undefined),
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "https://api.tavily.com/search") {
        return new Response("", { status: 404 });
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
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

      return jsonResponse({ results: [] });
    });

    vi.stubGlobal("fetch", fetchMock);

    const campaigns = await fetchKickstarterCampaigns(10);

    expect(campaigns).toEqual([
      expect.objectContaining({
        campaignName: "AInoon: AI Smart Glasses That Actually Help You — Instantly",
        campaignUrl: "https://www.kickstarter.com/projects/ainoon/ainoon-ai-smart-glasses-that-actually-help-you-instantly",
        startedLabel: "Apr 1 2026",
        pledgedLabel: "$95,000",
      }),
    ]);
  });

  it("falls back to a title search when the exact campaign lookup still omits the funding period", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "https://api.tavily.com/search") {
        return new Response("", { status: 404 });
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const query = String(body.query ?? "");

      if (query.includes('"ai wearable" Kickstarter') && body.time_range === "year") {
        return jsonResponse({
          results: [
            {
              title: "Beyond AI Glasses: World's First Multi-User AI Wearable - Kickstarter",
              url: "https://www.kickstarter.com/projects/2050126361/beyond-ai-glasses-worlds-first-multi-user-ai-wearable",
              content:
                "Beyond AI Glasses: World's First Multi-User AI Wearable. " +
                "127 backers pledged $33,729 to help bring this project to life. Last updated April 4, 2026.",
              raw_content:
                "# Beyond AI Glasses: World's First Multi-User AI Wearable by zone — Kickstarter " +
                "AI wearable with hands-free capture, coaching, and translation.",
              score: 0.97,
            },
          ],
        });
      }

      if (query === '"https://www.kickstarter.com/projects/2050126361/beyond-ai-glasses-worlds-first-multi-user-ai-wearable"') {
        return jsonResponse({
          results: [
            {
              title: "Beyond AI Glasses: World's First Multi-User AI Wearable - Kickstarter",
              url: "https://www.kickstarter.com/projects/2050126361/beyond-ai-glasses-worlds-first-multi-user-ai-wearable",
              content:
                "Beyond AI Glasses: World's First Multi-User AI Wearable. " +
                "127 backers pledged $33,729 to help bring this project to life. Last updated April 4, 2026.",
              raw_content:
                "# Beyond AI Glasses: World's First Multi-User AI Wearable by zone — Kickstarter " +
                "Hands-free capture and AI companion features.",
              score: 0.98,
            },
          ],
        });
      }

      if (query === '"Beyond AI Glasses: World\'s First Multi-User AI Wearable" site:kickstarter.com/projects') {
        return jsonResponse({
          results: [
            {
              title: "Beyond AI Glasses: World's First Multi-User AI Wearable",
              url: "https://www.kickstarter.com/projects/2050126361/beyond-ai-glasses-worlds-first-multi-user-ai-wearable/description",
              content:
                "Beyond AI Glasses: World's First Multi-User AI Wearable. " +
                "127 backers pledged $33,729 to help bring this project to life.",
              raw_content:
                "# Beyond AI Glasses: World's First Multi-User AI Wearable by zone — Kickstarter " +
                "### Funding period Apr 3 2026 - May 2 2026 (29 days).",
              score: 0.99,
            },
          ],
        });
      }

      return jsonResponse({ results: [] });
    });

    vi.stubGlobal("fetch", fetchMock);

    const campaigns = await fetchKickstarterCampaigns(50);

    expect(campaigns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campaignName: "Beyond AI Glasses: World's First Multi-User AI Wearable",
          startedLabel: "Apr 3 2026",
          pledgedLabel: "$33,729",
          campaignUrl: "https://www.kickstarter.com/projects/2050126361/beyond-ai-glasses-worlds-first-multi-user-ai-wearable",
        }),
      ]),
    );
  });
});
