import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sources/arxiv", () => ({
  fetchArxivPapers: vi.fn(),
}));

vi.mock("@/lib/sources/github", () => ({
  fetchGitHubTrendingRepos: vi.fn(),
}));

vi.mock("@/lib/sources/github-project-search", () => ({
  enrichGitHubProjectsWithNarrativeContext: vi.fn(async (projects: unknown) => projects),
}));

import { loadArxivPapersForRefresh, loadGitHubProjectsForRefresh } from "@/lib/refresh";
import { fetchArxivPapers } from "@/lib/sources/arxiv";
import { fetchGitHubTrendingRepos } from "@/lib/sources/github";

describe("refresh arxiv fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses live arxiv papers when the upstream fetch succeeds", async () => {
    vi.mocked(fetchArxivPapers).mockResolvedValue([
      {
        rank: 1,
        arxivId: "2603.00001",
        title: "Embodied Planning Kernel",
        summary: "Planning primitives for embodied agents.",
        publishedAt: new Date("2026-03-20T00:00:00Z"),
        updatedAt: new Date("2026-03-20T00:00:00Z"),
        authors: ["Alice Chen"],
        comment: "",
        categories: ["cs.RO"],
        primaryCategory: "cs.RO",
        arxivUrl: "https://arxiv.org/abs/2603.00001",
        pdfUrl: "https://arxiv.org/pdf/2603.00001.pdf",
        citationCount: 0,
        influentialCitationCount: 0,
        semanticScholarUrl: "",
        institutionNamesRaw: ["Stanford University"],
        venueBonus: 0,
        recencyBonus: 0,
        impactScore: 0,
      },
    ]);

    const prisma = {
      datasetVersion: { findFirst: vi.fn() },
      event: { findMany: vi.fn() },
    };

    const result = await loadArxivPapersForRefresh(prisma as never, 5);

    expect(result.warning).toBeNull();
    expect(result.papers).toHaveLength(1);
    expect(result.papers[0]?.stableId).toBe("paper:embodied-planning-kernel");
    expect(result.papers[0]?.institutionNamesRaw).toEqual(["Stanford University"]);
    expect(prisma.datasetVersion.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the active dataset when the upstream arxiv fetch fails", async () => {
    vi.mocked(fetchArxivPapers).mockRejectedValue(new Error("arXiv fetch failed and no cached result is available"));

    const prisma = {
      datasetVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: "dataset-active" }),
      },
      event: {
        findMany: vi.fn().mockResolvedValue([
          {
            paperLinks: [
              {
                paper: {
                  stableId: "paper:cached-robot-paper",
                  paperTitle: "Cached Robot Paper",
                  paperUrl: "https://arxiv.org/abs/2603.99999",
                  authorsJson: ["Bob Li"],
                  authorsCount: 1,
                  publishedAt: new Date("2026-03-18T00:00:00Z"),
                  abstractRaw: "A cached robotics paper.",
                  codeUrl: null,
                  institutionNamesRaw: ["Shanghai AI Lab"],
                  relatedProjectIds: ["repo:cached/demo"],
                },
              },
            ],
          },
        ]),
      },
    };

    const result = await loadArxivPapersForRefresh(prisma as never, 5);

    expect(result.warning).toContain("回退到当前活跃数据集");
    expect(result.papers).toHaveLength(1);
    expect(result.papers[0]).toMatchObject({
      stableId: "paper:cached-robot-paper",
      paperTitle: "Cached Robot Paper",
      authors: ["Bob Li"],
      institutionNamesRaw: ["Shanghai AI Lab"],
      relatedProjectStableIds: ["repo:cached/demo"],
    });
    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
      }),
    );
  });

  it("skips arxiv updates when both live fetch and persistent fallback are unavailable", async () => {
    vi.mocked(fetchArxivPapers).mockRejectedValue(new Error("arXiv fetch failed and no cached result is available"));

    const prisma = {
      datasetVersion: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      event: {
        findMany: vi.fn(),
      },
    };

    const result = await loadArxivPapersForRefresh(prisma as never, 5);

    expect(result.papers).toEqual([]);
    expect(result.warning).toContain("已跳过 arXiv 更新");
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it("uses live github projects when the upstream fetch succeeds", async () => {
    vi.mocked(fetchGitHubTrendingRepos).mockResolvedValue([
      {
        rank: 1,
        fullName: "open/alpha",
        htmlUrl: "https://github.com/open/alpha",
        description: "Embodied runtime",
        language: "TypeScript",
        stars: 1200,
        forks: 50,
        todayStars: 42,
        contributorAvatarUrls: [],
        contributorsCount: 3,
        contributors: [],
        topics: ["embodied"],
        createdAt: new Date("2026-03-20T00:00:00Z"),
        updatedAt: new Date("2026-03-21T00:00:00Z"),
        owner: {
          login: "open",
          htmlUrl: "https://github.com/open",
          type: "Organization",
        },
        readmeExcerpt: "Embodied runtime readme",
      },
    ]);

    const prisma = {
      datasetVersion: { findFirst: vi.fn() },
      event: { findMany: vi.fn() },
    };

    const result = await loadGitHubProjectsForRefresh(prisma as never, 5);

    expect(result.warning).toBeNull();
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      stableId: "repo:open/alpha",
      repoName: "open/alpha",
      ownerName: "open",
      stars: 1200,
    });
    expect(prisma.datasetVersion.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the active dataset when the upstream github fetch fails", async () => {
    vi.mocked(fetchGitHubTrendingRepos).mockRejectedValue(new Error("GitHub trending fetch failed and no cached result is available"));

    const prisma = {
      datasetVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: "dataset-active" }),
      },
      event: {
        findMany: vi.fn().mockResolvedValue([
          {
            projectLinks: [
              {
                project: {
                  stableId: "repo:cached/alpha",
                  repoName: "cached/alpha",
                  repoUrl: "https://github.com/cached/alpha",
                  ownerName: "cached",
                  ownerUrl: "https://github.com/cached",
                  stars: 800,
                  starDelta7d: 75,
                  contributorsCount: 2,
                  repoCreatedAt: new Date("2026-03-10T00:00:00Z"),
                  repoUpdatedAt: new Date("2026-03-21T00:00:00Z"),
                  repoDescriptionRaw: "Cached project",
                  readmeExcerptRaw: "Cached readme",
                  relatedPaperIdsJson: ["paper:cached-robot-paper"],
                },
              },
            ],
          },
        ]),
      },
    };

    const result = await loadGitHubProjectsForRefresh(prisma as never, 5);

    expect(result.warning).toContain("回退到当前活跃数据集");
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      stableId: "repo:cached/alpha",
      repoName: "cached/alpha",
      ownerName: "cached",
      relatedPaperStableIds: ["paper:cached-robot-paper"],
    });
  });
});
