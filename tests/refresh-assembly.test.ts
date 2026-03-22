import { describe, expect, it } from "vitest";

import { buildLiveDatasetBundle } from "@/lib/refresh";

describe("refresh dataset assembly", () => {
  it("keeps confirmed links, ignores candidate-only links, and preserves source ordering", () => {
    const githubProjects = [
      {
        stableId: "repo:open/alpha",
        repoName: "open/alpha",
        repoUrl: "https://github.com/open/alpha",
        ownerName: "alice-chen",
        ownerUrl: "https://github.com/alice-chen",
        stars: 1200,
        starDelta7d: 180,
        todayStars: 42,
        contributorsCount: 5,
        repoCreatedAt: new Date("2026-03-18T00:00:00Z"),
        repoUpdatedAt: new Date("2026-03-21T00:00:00Z"),
        repoDescriptionRaw: "Embodied agent runtime",
        readmeExcerptRaw: "robot planning stack",
      },
    ];

    const papers = [
      {
        stableId: "paper:embodied-alpha",
        paperTitle: "Embodied Alpha",
        paperUrl: "https://arxiv.org/abs/2603.00001",
        authors: ["Alice Chen"],
        authorsCount: 1,
        publishedAt: new Date("2026-03-20T00:00:00Z"),
        abstractRaw: "robot planning for embodied agents",
        codeUrl: "https://github.com/open/alpha",
        semanticScholarUrl: "https://semanticscholar.org/paper/alpha",
      },
      {
        stableId: "paper:embodied-beta",
        paperTitle: "Embodied Beta",
        paperUrl: "https://arxiv.org/abs/2603.00002",
        authors: ["Bob Li"],
        authorsCount: 1,
        publishedAt: new Date("2026-03-19T00:00:00Z"),
        abstractRaw: "robot manipulation benchmark",
      },
    ];

    const people = [
      {
        stableId: "github:alice-chen",
        name: "Alice Chen",
        identitySummaryZh: "GitHub 构建者",
        evidenceSummaryZh: "创建相关 repo",
        sourceUrls: ["https://github.com/alice-chen"],
        githubUrl: "https://github.com/alice-chen",
        organizationNamesRaw: [],
      },
      {
        stableId: "github:alice-c",
        name: "Alice C.",
        identitySummaryZh: "研究者",
        evidenceSummaryZh: "参与 repo",
        sourceUrls: ["https://github.com/alice-chen"],
        githubUrl: "https://github.com/alice-chen",
        organizationNamesRaw: [],
      },
      {
        stableId: "author:bob-li",
        name: "Bob Li",
        identitySummaryZh: "AI 研究者",
        evidenceSummaryZh: "是当前论文作者",
        sourceUrls: [],
        organizationNamesRaw: [],
      },
    ];

    const repoPaperLinks = [
      {
        projectStableId: "repo:open/alpha",
        paperStableId: "paper:embodied-alpha",
        evidenceType: "paper_code_url",
        evidenceSourceUrl: "https://github.com/open/alpha",
        evidenceExcerpt: "explicit code url",
        confidence: "confirmed" as const,
      },
      {
        projectStableId: "repo:open/alpha",
        paperStableId: "paper:embodied-beta",
        evidenceType: "readme_overlap",
        evidenceSourceUrl: "https://github.com/open/alpha",
        evidenceExcerpt: "partial overlap",
        confidence: "candidate" as const,
      },
    ];

    const bundle = buildLiveDatasetBundle(githubProjects, papers, people, repoPaperLinks);

    expect(bundle.events.map((event) => event.sourceType)).toEqual(["github", "arxiv", "arxiv"]);
    expect(bundle.events[0]?.paperStableIds).toEqual(["paper:embodied-alpha"]);
    expect(bundle.events[0]?.eventType).toBe("implementation");
    expect(bundle.events[1]?.projectStableIds).toEqual(["repo:open/alpha"]);
    expect(bundle.events[1]?.displayRank).toBe(1);
    expect(bundle.events[2]?.projectStableIds).toEqual([]);
    expect(bundle.events[2]?.eventType).toBe("new_paper");
    expect(bundle.events[2]?.displayRank).toBe(2);
    expect(bundle.people).toHaveLength(2);
  });
});
