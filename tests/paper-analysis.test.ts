import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("generatePaperAnalysis", () => {
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
  const originalTavilyApiKey = process.env.TAVILY_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env.OPENAI_API_KEY = "";
    process.env.TAVILY_API_KEY = "test-tavily-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    process.env.TAVILY_API_KEY = originalTavilyApiKey;
  });

  it("falls back to structured paper copy and preserves source references when OpenAI is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: "GAPG: Goal-Aware Push-Grasp Policy 论文解读",
              url: "https://www.jiqizhixin.com/articles/gapg",
              content: "文章把 GAPG 描述为 arXiv:2603.12345 对应的 clutter 场景推抓协同操作策略。",
            },
            {
              title: "机器人推抓论文 GAPG：Goal-Aware Push-Grasp Policy",
              url: "https://www.qbitai.com/2026/03/gapg.html",
              content: "文章强调 arXiv:2603.12345 把推和抓统一到一套目标感知策略里。",
            },
          ],
        }),
      }),
    );

    const { generatePaperAnalysis } = await import("@/lib/paper-analysis");

    const result = await generatePaperAnalysis({
      stableId: "event:arxiv:gapg",
      eventTitleZh: "新 paper “GAPG” 发布",
      eventHighlightZh: "机器人推抓方向出现新的论文入口。",
      eventTag: "Robotics",
      relatedRepoCount: 1,
      paper: {
        paperTitle: "GAPG: Goal-Aware Push-Grasp Policy",
        paperUrl: "https://arxiv.org/abs/2603.12345",
        authors: ["Alice Chen", "Bob Li"],
        abstractRaw: "We propose GAPG for push-grasp manipulation in cluttered scenes.",
        pdfTextRaw: `
Abstract
We propose GAPG for push-grasp manipulation in cluttered scenes.
1 Introduction
Push-grasp manipulation remains difficult in cluttered scenes.
3 Method
GAPG organizes push and grasp into a goal-aware policy.
6 Conclusion
The policy improves execution stability.
`,
        codeUrl: null,
      },
    });

    expect(result.analysisSummary).toBeNull();
    expect(result.analysisReferences).toHaveLength(3);
    expect(result.analysisReferences[0]).toMatchObject({
      label: "Paper PDF",
      url: "https://arxiv.org/pdf/2603.12345.pdf",
    });
    expect(result.paperExplanation?.problem).toContain("[1]");
    expect(result.paperExplanation?.method).toContain("[1]");
    expect(result.paperExplanation?.method).toContain("[2]");
    expect(result.paperExplanation?.contribution).toContain("[2]");
  }, 15_000);
});
