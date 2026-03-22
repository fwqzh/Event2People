import { describe, expect, it } from "vitest";

import { buildPersonCopySummary } from "@/lib/copy";
import { classifyEventTag } from "@/lib/event-tag";
import { shouldMergePeople } from "@/lib/merge-people";
import { normalizeEventBatch, normalizePersonBatch } from "@/lib/openai-enrichment";
import { buildRecentActivitySummary } from "@/lib/pipeline";
import { decideRepoPaperLink } from "@/lib/repo-paper-linking";
import { buildArxivSearchQuery, computeImpactScore, matchesEmbodiedPaper, parseArxivAtomXml } from "@/lib/sources/arxiv";
import { buildSampleDataset } from "@/lib/sample-data";
import { parseTrendingDailyHtml } from "@/lib/sources/github";
import { clampZh } from "@/lib/text";

describe("event tag classification", () => {
  it("prefers embodied AI keywords", () => {
    expect(classifyEventTag(["embodied planning kernel", "robot policy"]).tag).toBe("Embodied AI");
  });

  it("falls back to Other when no keyword matches", () => {
    expect(classifyEventTag(["distributed cache", "edge worker"]).tag).toBe("Other");
  });
});

describe("repo paper linking", () => {
  it("confirms explicit paper code url", () => {
    const decision = decideRepoPaperLink({
      projectTitle: "vox-agent",
      paperTitle: "Robot Web Pilot",
      paperCodeUrl: "https://github.com/alice-chen/vox-agent",
    });

    expect(decision.confidence).toBe("confirmed");
    expect(decision.evidenceType).toBe("paper_code_url");
  });

  it("does not upgrade weak title overlap to confirmed", () => {
    const decision = decideRepoPaperLink({
      projectTitle: "pilot-implementation",
      paperTitle: "Robot Web Pilot",
      readmeText: "A small pilot demo",
    });

    expect(decision.confidence).not.toBe("confirmed");
  });
});

describe("person merge", () => {
  it("merges only when direct profile URL is identical", () => {
    const decision = shouldMergePeople(
      {
        stableId: "left",
        name: "Alice Chen",
        identitySummaryZh: "Stanford 博士生",
        evidenceSummaryZh: "创建 repo",
        sourceUrls: [],
        githubUrl: "https://github.com/alice-chen",
      },
      {
        stableId: "right",
        name: "Alice C.",
        identitySummaryZh: "研究者",
        evidenceSummaryZh: "参与 repo",
        sourceUrls: [],
        githubUrl: "https://github.com/alice-chen",
      },
    );

    expect(decision.shouldMerge).toBe(true);
  });

  it("keeps low-confidence same-name candidates separate", () => {
    const decision = shouldMergePeople(
      {
        stableId: "left",
        name: "Jian Wu",
        identitySummaryZh: "CMU 研究者",
        evidenceSummaryZh: "论文作者",
        sourceUrls: [],
        schoolNamesRaw: ["CMU"],
      },
      {
        stableId: "right",
        name: "Jian Wu",
        identitySummaryZh: "Tsinghua 研究者",
        evidenceSummaryZh: "论文作者",
        sourceUrls: [],
        schoolNamesRaw: ["Tsinghua University"],
      },
    );

    expect(decision.shouldMerge).toBe(false);
  });
});

describe("copy and text rules", () => {
  it("keeps Chinese copy fields concise", () => {
    expect(clampZh("这是一个用于验证长度限制是否生效的很长很长的中文句子", 12).length).toBeLessThanOrEqual(12);
  });

  it("builds person copy summary with source and links", () => {
    const summary = buildPersonCopySummary(
      {
        stableId: "github:alice-chen",
        name: "Alice Chen",
        identitySummaryZh: "Stanford Robotics 博士生 · 前 DeepMind",
        evidenceSummaryZh: "创建 repo VoxAgent；实现 Paper “Robot Web Pilot”",
        sourceUrls: [],
        links: [{ label: "GitHub", url: "https://github.com/alice-chen" }],
      },
      "Paper “Robot Web Pilot” 获得开源实现",
      "最近活动：创建 repo VoxAgent，近 7 天 +312 stars",
    );

    expect(summary).toContain("来源事件");
    expect(summary).toContain("GitHub");
  });
});

describe("sample dataset", () => {
  it("provides enough events for the default 10-item sections", () => {
    const dataset = buildSampleDataset();
    expect(dataset.events.filter((event) => event.sourceType === "github").length).toBeGreaterThanOrEqual(10);
    expect(dataset.events.filter((event) => event.sourceType === "arxiv").length).toBeGreaterThanOrEqual(10);
  });

  it("generates pipeline-oriented recent activity summaries", () => {
    expect(buildRecentActivitySummary({ repoName: "VoxAgent", starDelta7d: 312 })).toContain("近 7 天 +312 stars");
  });
});

describe("github trending daily parsing", () => {
  it("parses today stars and sorts by daily gain", () => {
    const html = `
      <article class="Box-row">
        <h2><a href="/foo/alpha">foo / alpha</a></h2>
        <p>alpha project</p>
        <span itemprop="programmingLanguage">TypeScript</span>
        <a href="/foo/alpha/stargazers">1,234</a>
        <a href="/foo/alpha/forks">56</a>
        <span class="float-sm-right">321 stars today</span>
      </article>
      <article class="Box-row">
        <h2><a href="/bar/beta">bar / beta</a></h2>
        <p>beta project</p>
        <span itemprop="programmingLanguage">Python</span>
        <a href="/bar/beta/stargazers">9,999</a>
        <a href="/bar/beta/forks">88</a>
        <span class="float-sm-right">1,024 stars today</span>
      </article>
    `;

    const result = parseTrendingDailyHtml(html);

    expect(result[0].fullName).toBe("bar/beta");
    expect(result[0].todayStars).toBe(1024);
    expect(result[1].todayStars).toBe(321);
  });
});

describe("arxiv embodied ranking rules", () => {
  it("builds a recent-window query with embodied phrases", () => {
    const query = buildArxivSearchQuery(new Date("2026-03-21T12:00:00Z"));

    expect(query).toContain('all:"embodied intelligence"');
    expect(query).toContain('all:"mobile manipulation"');
    expect(query).toContain("submittedDate:[202602190000 TO 202603212359]");
  });

  it("parses atom xml comment and primary category fields", () => {
    const xml = `
      <feed xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2503.12345v1</id>
          <title>Embodied Agent Planning</title>
          <updated>2026-03-20T12:00:00Z</updated>
          <published>2026-03-18T12:00:00Z</published>
          <summary>Robot manipulation with a vision-language-action policy.</summary>
          <author><name>Alice Chen</name></author>
          <link href="https://arxiv.org/abs/2503.12345v1" rel="alternate" type="text/html" />
          <link href="https://arxiv.org/pdf/2503.12345v1" rel="related" type="application/pdf" title="pdf" />
          <category term="cs.RO" />
          <arxiv:primary_category term="cs.RO" />
          <arxiv:comment>Accepted at RSS 2026</arxiv:comment>
        </entry>
      </feed>
    `;

    const [paper] = parseArxivAtomXml(xml);

    expect(paper.arxivId).toBe("2503.12345");
    expect(paper.primaryCategory).toBe("cs.RO");
    expect(paper.comment).toContain("RSS");
    expect(paper.pdfUrl).toContain("/pdf/2503.12345v1");
  });

  it("keeps embodied papers by category or keyword", () => {
    expect(
      matchesEmbodiedPaper({
        arxivId: "2503.00001",
        title: "General planner",
        summary: "A broad system.",
        publishedAt: new Date("2026-03-01T00:00:00Z"),
        updatedAt: new Date("2026-03-01T00:00:00Z"),
        authors: ["Alice"],
        comment: "",
        categories: ["cs.RO"],
        primaryCategory: "cs.RO",
        arxivUrl: "https://arxiv.org/abs/2503.00001",
        pdfUrl: "https://arxiv.org/pdf/2503.00001.pdf",
      }),
    ).toBe(true);

    expect(
      matchesEmbodiedPaper({
        arxivId: "2503.00002",
        title: "Vision-Language-Action policy",
        summary: "Improves dexterous manipulation.",
        publishedAt: new Date("2026-03-01T00:00:00Z"),
        updatedAt: new Date("2026-03-01T00:00:00Z"),
        authors: ["Bob"],
        comment: "",
        categories: ["cs.CL"],
        primaryCategory: "cs.CL",
        arxivUrl: "https://arxiv.org/abs/2503.00002",
        pdfUrl: "https://arxiv.org/pdf/2503.00002.pdf",
      }),
    ).toBe(true);
  });

  it("scores venue and recency on top of citation signals", () => {
    const score = computeImpactScore(
      {
        citationCount: 3,
        influentialCitationCount: 1,
        comment: "Accepted at RSS 2026, camera ready",
        publishedAt: new Date("2026-03-18T00:00:00Z"),
      },
      new Date("2026-03-21T00:00:00Z"),
    );

    expect(score.venueBonus).toBeGreaterThanOrEqual(60);
    expect(score.recencyBonus).toBeGreaterThan(0);
    expect(score.impactScore).toBeGreaterThan(0);
  });
});

describe("openai enrichment normalization", () => {
  it("keeps event AI copy within length limits", () => {
    const dataset = buildSampleDataset();
    const [event] = dataset.events;
    const result = normalizeEventBatch([event], {
      items: [
        {
          stableId: event.stableId,
          eventTitleZh: "这是一个为了验证长度限制是否仍然会生效而故意写得非常非常长的标题",
          eventHighlightZh: "这是一个为了验证长度限制是否仍然会生效而故意写得非常非常长的一句话亮点。",
          eventDetailSummaryZh: "这是一个为了验证详情摘要在 AI 返回很长内容时仍然会被安全截断的说明字段。",
        },
      ],
    });

    expect(result.events[0].eventTitleZh.length).toBeLessThanOrEqual(32);
    expect(result.events[0].eventHighlightZh.length).toBeLessThanOrEqual(20);
    expect((result.events[0].eventDetailSummaryZh ?? "").length).toBeLessThanOrEqual(64);
  });

  it("falls back to existing person copy when AI output is incomplete", () => {
    const dataset = buildSampleDataset();
    const [person] = dataset.people;
    const result = normalizePersonBatch([person], {
      items: [
        {
          stableId: person.stableId,
          identitySummaryZh: "   ",
          evidenceSummaryZh: "证据一；证据二；证据三",
        },
      ],
    });

    expect(result.people[0].identitySummaryZh).toBe(person.identitySummaryZh);
    expect(result.people[0].evidenceSummaryZh).toBe("证据一；证据二");
  });
});
