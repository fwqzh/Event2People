import { describe, expect, it } from "vitest";

import {
  coalesceKickstarterCampaigns,
  createKickstarterCampaignFromProjectPage,
  extractKickstarterDiscoverCampaignsFromHtml,
  extractKickstarterDiscoverProjectUrls,
  extractKickstarterStructuredMetadata,
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
      normalizeKickstarterCampaignUrl("https://www.kickstarter.com/projects/lenaortiz/orbital-coder/community"),
    ).toBe("https://www.kickstarter.com/projects/lenaortiz/orbital-coder");
    expect(
      normalizeKickstarterCampaignUrl("https://www.kickstarter.com/projects/lenaortiz/orbital-coder/rewards"),
    ).toBe("https://www.kickstarter.com/projects/lenaortiz/orbital-coder");
    expect(
      normalizeKickstarterCampaignUrl("https://www.kickstarter.com/projects/lenaortiz/orbital-coder/faqs"),
    ).toBe("https://www.kickstarter.com/projects/lenaortiz/orbital-coder");
    expect(
      normalizeKickstarterCampaignUrl("https://www.kickstarter.com/projects/lenaortiz/orbital-coder/comments"),
    ).toBe("https://www.kickstarter.com/projects/lenaortiz/orbital-coder");
    expect(
      normalizeKickstarterCampaignUrl("https://www.kickstarter.com/projects/lenaortiz/orbital-coder/creator"),
    ).toBe("");
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

  it("extracts canonical project urls from the technology discover newest list", () => {
    const urls = extractKickstarterDiscoverProjectUrls(`
      <main>
        <a href="/projects/dataleakz/dataleakz-data-breach-intelligence-0?ref=discovery_category_newest&total_hits=57485&category_id=332">
          DataLeakz - Data Breach Intelligence
        </a>
        <a href="/projects/dataleakz/dataleakz-data-breach-intelligence-0?ref=discovery_category_newest&total_hits=57485&category_id=332"></a>
        <a href="/projects/everysight/maverick-full-color-ai-ar-glasses?ref=discovery_category_newest&total_hits=57485&category_id=337">
          Maverick AI: The Lightest, Full Color AR+AI Glasses
        </a>
        <a href="/projects/rewindpix/rewindpix-a-non-disposable-digital-film-camera">
          Rewindpix
        </a>
      </main>
    `);

    expect(urls).toEqual([
      "https://www.kickstarter.com/projects/dataleakz/dataleakz-data-breach-intelligence-0",
      "https://www.kickstarter.com/projects/everysight/maverick-full-color-ai-ar-glasses",
    ]);
  });

  it("skips technology discover projects when pledged is below the minimum threshold", () => {
    const campaigns = extractKickstarterDiscoverCampaignsFromHtml(
      `
        <main>
          <a href="/projects/dataleakz/dataleakz-data-breach-intelligence-0?ref=discovery_category_newest&total_hits=57485&category_id=332">
            DataLeakz - Data Breach Intelligence
          </a>
          <script type="application/json">
            {&quot;id&quot;:1,&quot;photo&quot;:{&quot;1024x576&quot;:&quot;https://images.example.com/dataleakz.png&quot;},&quot;name&quot;:&quot;DataLeakz - Data Breach Intelligence&quot;,&quot;blurb&quot;:&quot;Dataleakz is a modern breach checker, but more simple and smarter.&quot;,&quot;goal&quot;:10000.0,&quot;pledged&quot;:0.0,&quot;state&quot;:&quot;live&quot;,&quot;slug&quot;:&quot;dataleakz-data-breach-intelligence-0&quot;,&quot;currency&quot;:&quot;USD&quot;,&quot;currency_symbol&quot;:&quot;$&quot;,&quot;deadline&quot;:1781734202,&quot;launched_at&quot;:1776550202,&quot;backers_count&quot;:0,&quot;creator&quot;:{&quot;name&quot;:&quot;Baris Ayarkan&quot;,&quot;urls&quot;:{&quot;web&quot;:{&quot;user&quot;:&quot;https://www.kickstarter.com/profile/dataleakz&quot;}}}}
          </script>
        </main>
      `,
      new Date("2026-04-18T23:00:00.000Z"),
    );

    expect(campaigns).toEqual([]);
  });

  it("hydrates started date and creator metadata from structured project html", () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://images.example.com/maverick.png" />
        </head>
        <body>
          <script>
            window.__data = {
              "project_creator_name":"Everysight",
              "project_current_amount_pledged_usd":802476.0,
              "project_goal_usd":10000.0,
              "project_backers_count":2009,
              "project_launched_at":"2026-03-31T09:57:42-04:00",
              "project_blurb":"OLED In-Lens Display | Native Eye-Tracking | All-day battery life | Only 47g | Live Translation | Rx Ready | AI-Camera | 28° FOV",
              "project_photo_full":"https://images.example.com/maverick.png"
            };
          </script>
        </body>
      </html>
    `;
    const metadata = extractKickstarterStructuredMetadata(
      html,
      "https://www.kickstarter.com/projects/everysight/maverick-full-color-ai-ar-glasses",
    );

    expect(metadata.creatorName).toBe("Everysight");
    expect(metadata.imageUrl).toBe("https://images.example.com/maverick.png");
    expect(metadata.startedAt?.toISOString()).toContain("2026-03-31");
    expect(metadata.startedLabel).toBe("Mar 31 2026");
    expect(metadata.pledgedAmount).toBe(802476);
    expect(metadata.goalAmount).toBe(10000);
    expect(metadata.backersCount).toBe(2009);
  });

  it("builds a campaign from a project page using structured launched_at metadata", () => {
    const candidate = createKickstarterCampaignFromProjectPage({
      pageTitle: "Maverick AI: The Lightest, Full Color AR+AI Glasses by Everysight — Kickstarter",
      pageUrl: "https://www.kickstarter.com/projects/everysight/maverick-full-color-ai-ar-glasses",
      pageText:
        "Project We Love Wearables Seattle, WA $802,476 pledged of $10,000 goal 2,009 backers 26 days to go " +
        "Maverick AI: The Lightest, Full Color AR+AI Glasses OLED In-Lens Display | Native Eye-Tracking | All-day battery life | Only 47g | Live Translation | Rx Ready | AI-Camera | 28° FOV",
      pageHtml: `
        <script>
          window.__data = {
            "project_creator_name":"Everysight",
            "project_current_amount_pledged_usd":802476.0,
            "project_goal_usd":10000.0,
            "project_backers_count":2009,
            "project_launched_at":"2026-03-31T09:57:42-04:00",
            "project_blurb":"OLED In-Lens Display | Native Eye-Tracking | All-day battery life | Only 47g | Live Translation | Rx Ready | AI-Camera | 28° FOV",
            "project_photo_full":"https://images.example.com/maverick.png"
          };
        </script>
      `,
      now: new Date("2026-04-18T12:00:00.000Z"),
    });

    expect(candidate).toBeTruthy();
    expect(candidate?.campaignName).toBe("Maverick AI: The Lightest, Full Color AR+AI Glasses");
    expect(candidate?.creatorName).toBe("Everysight");
    expect(candidate?.startedLabel).toBe("Mar 31 2026");
    expect(candidate?.startedAt?.toISOString()).toContain("2026-03-31");
    expect(candidate?.pledgedAmount).toBe(802476);
    expect(candidate?.goalAmount).toBe(10000);
    expect(candidate?.backersCount).toBe(2009);
    expect(candidate?.imageUrl).toBe("https://images.example.com/maverick.png");
  });

  it("drops official technology discover projects when pledged is below the minimum threshold", () => {
    const candidate = createKickstarterCampaignFromProjectPage({
      pageTitle: "DataLeakz - Data Breach Intelligence by Baris Ayarkan — Kickstarter",
      pageUrl: "https://www.kickstarter.com/projects/dataleakz/dataleakz-data-breach-intelligence-0",
      pageText:
        "Apps Raleigh, NC $0 pledged of $10,000 goal 0 backers 59 days to go Back this project " +
        "DataLeakz - Data Breach Intelligence Dataleakz is a modern breach checker, but more simple and smarter. " +
        "You can search email, username, or domain and see real risk.",
      pageHtml: `
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
      now: new Date("2026-04-18T23:00:00.000Z"),
    });

    expect(candidate).toBeNull();
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

  it("filters out campaigns with pledged amounts below ten thousand usd", () => {
    const candidate = parseKickstarterCampaignCandidate({
      title: "Pocket Memo AI Recorder by Memo Labs - Kickstarter",
      url: "https://www.kickstarter.com/projects/memolabs/pocket-memo-ai-recorder",
      content:
        "Memo Labs is raising funds for Pocket Memo AI Recorder on Kickstarter! " +
        "AI voice notes, summary generation, and local transcription. $9,500 pledged of $20,000 goal 182 backers 18 days left.",
      score: 0.94,
    });

    expect(candidate).toBeNull();
  });

  it("keeps strong ai hardware candidates even when Tavily omits funding metrics", () => {
    const candidate = parseKickstarterCampaignCandidate({
      title: "Dymesty AI Glasses: World's First Titanium AI Glasses by Dymesty — Kickstarter",
      url: "https://www.kickstarter.com/projects/dymesty/dymesty-ai-glasses-when-sleek-design-meets-ai/rewards",
      content:
        "Dymesty is raising funds for Dymesty AI Glasses: World's First Titanium AI Glasses on Kickstarter! Open-ear audio, real-time AI assistance, translation, and a 12MP camera built into lightweight titanium frames.",
      score: 0.96,
    });

    expect(candidate).toBeTruthy();
    expect(candidate?.campaignUrl).toBe("https://www.kickstarter.com/projects/dymesty/dymesty-ai-glasses-when-sleek-design-meets-ai");
    expect(candidate?.pledgedAmount).toBeNull();
    expect(candidate?.statusLabel).toBe("Unknown");
  });

  it("ignores kickstarter navigation taxonomy noise when parsing ai hardware campaigns", () => {
    const candidate = parseKickstarterCampaignCandidate({
      title: "AInoon: AI Smart Glasses That Actually Help You — Instantly",
      url: "https://www.kickstarter.com/projects/ainoon/ainoon-ai-smart-glasses-that-actually-help-you-instantly",
      content:
        "# AInoon: AI Smart Glasses That Actually Help You — Instantly by AInoon — Kickstarter " +
        "[](https://www.kickstarter.com/?ref=nav) [For creators](https://www.kickstarter.com/creators?ref=nav) " +
        "[Tabletop Games](https://www.kickstarter.com/discover/categories/games/tabletop%20games) " +
        "[Comics](https://www.kickstarter.com/discover/categories/comics) " +
        "[Film](https://www.kickstarter.com/discover/categories/film%20&%20video) " +
        "[Video Games](https://www.kickstarter.com/discover/categories/games/video%20games) " +
        "AInoon is raising funds for AInoon: AI Smart Glasses That Actually Help You — Instantly on Kickstarter! " +
        "AI smart glasses with translation, a 12MP camera, real-time assistance, and open-ear audio. " +
        "Funding period Apr 1 2026 - Apr 30 2026 (29 days). $95,000 pledged of $20,000 goal 800 backers 11 days left.",
      score: 0.98,
    });

    expect(candidate).toBeTruthy();
    expect(candidate?.campaignName).toBe("AInoon: AI Smart Glasses That Actually Help You — Instantly");
    expect(candidate?.creatorName).toBe("AInoon");
    expect(candidate?.pledgedAmount).toBe(95000);
    expect(candidate?.daysLeftLabel).toBe("11 days");
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

  it("still filters out real tabletop projects even when Tavily content includes kickstarter navigation", () => {
    const candidate = parseKickstarterCampaignCandidate({
      title: "Realm of Reckoning by IV Studios - Kickstarter",
      url: "https://www.kickstarter.com/projects/ivstudios/realm-of-reckoning",
      content:
        "# Realm of Reckoning by IV Studios - Kickstarter " +
        "[](https://www.kickstarter.com/?ref=nav) [For creators](https://www.kickstarter.com/creators?ref=nav) " +
        "[Tabletop Games](https://www.kickstarter.com/discover/categories/games/tabletop%20games) " +
        "[Film](https://www.kickstarter.com/discover/categories/film%20&%20video) " +
        "IV Studios is raising funds for Realm of Reckoning on Kickstarter! " +
        "A fantasy board game with miniatures, campaign books, and tabletop battles. " +
        "$672,875 pledged of $50,000 goal 5,824 backers 11 days left.",
      score: 0.95,
    });

    expect(candidate).toBeNull();
  });

  it("still rejects weak consumer electronics pages when there is no funding signal", () => {
    const candidate = parseKickstarterCampaignCandidate({
      title: "TIMES FLY - Running sunglasses have been reinvented - Kickstarter",
      url: "https://www.kickstarter.com/projects/times/times-fly-running-sunglasses-have-been-reinvented",
      content:
        "Times Eyewear is raising funds for TIMES FLY - Running sunglasses have been reinvented on Kickstarter! Run light and stay secure with our unique strap system.",
      score: 0.98,
    });

    expect(candidate).toBeNull();
  });

  it("deduplicates campaigns and sorts by started date, then live status, pledged, backers, and recency", () => {
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
      "Atlas Arm",
      "FramePilot",
      "Echo Clip",
    ]);
  });
});
