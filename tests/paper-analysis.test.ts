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
    vi.doUnmock("openai");
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
  }, 30_000);

  it("generates paper-specific detailed analysis with aligned reference numbering when OpenAI is enabled", async () => {
    const openAiCreateMock = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              problemZh:
                "这篇论文聚焦 clutter 场景里的目标导向推抓协同问题，重点不是泛泛的机械臂控制，而是把推和抓放进同一个目标感知决策闭环里。[1] 中文解读也普遍把它视作对传统分步式抓取策略的补强。[2]",
              methodZh:
                "方法上，GAPG 先显式建模目标物体和周围障碍之间的几何关系，再把 push / grasp 动作统一进一套 goal-aware policy 中，避免两套策略各自优化。[1] 中文来源也会强调它把“先推后抓”从规则流程改成联合决策。[2]",
              contributionZh:
                "核心贡献在于，它不是只提高单一步骤精度，而是把 clutter manipulation 里的推抓联动做成了一个可整体优化的策略接口，并在实验里验证了执行稳定性收益。[1]",
              analysisParagraphsZh: [
                "从论文问题定义看，GAPG 针对的是 clutter manipulation 里最常见的矛盾：目标物体往往被遮挡或卡住，单纯直接抓取成功率不高，而传统“先推再抓”流程又容易因为动作脱节带来累计误差。[1] 中文互联网对它的总结也基本围绕这一点展开，即它试图把推抓协同从启发式流程改成真正的目标导向策略。[2]",
                "方法上，这篇论文把目标感知的几何信息放在策略中心位置，让系统在每一步都同时考虑“当前该不该推”“推完是否更利于抓”“抓的收益是否已经超过继续整理场景的收益”。[1] 这也是中文解读里反复强调的点：它不是新增一个推模块，而是把 push / grasp 统一进同一个决策框架。[2]",
                "从结果和价值看，论文想证明的不是某个单独 benchmark 数字，而是这种 goal-aware 的联合策略能更稳定地处理遮挡、拥挤和目标受限场景。[1] 这让它对真实机器人抓取链路更有参考意义，因为工程侧真正关心的是端到端成功率，而不是单一步骤看起来更聪明。[1] 如果后续有公开实现，它会更适合作为 clutter 操作任务里的策略底座来继续复用。[1]",
              ],
            }),
          },
        },
      ],
    });

    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        chat = {
          completions: {
            create: openAiCreateMock,
          },
        };
      },
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: "GAPG 论文解读：把推抓协同变成目标导向决策",
              url: "https://www.jiqizhixin.com/articles/gapg",
              content: "文章认为 GAPG 的关键在于把推和抓统一到一个 goal-aware 的策略框架里。",
            },
          ],
        }),
      }),
    );
    process.env.OPENAI_API_KEY = "test-openai-key";

    const { generatePaperAnalysis } = await import("@/lib/paper-analysis");

    const result = await generatePaperAnalysis({
      stableId: "event:arxiv:gapg-openai",
      eventTitleZh: "新 paper “GAPG” 发布",
      eventHighlightZh: "机器人推抓方向出现新的论文入口。",
      eventTag: "Robotics",
      relatedRepoCount: 0,
      paper: {
        paperTitle: "GAPG: Goal-Aware Push-Grasp Policy",
        paperUrl: "https://arxiv.org/abs/2603.12345",
        authors: ["Alice Chen", "Bob Li"],
        abstractRaw: "We propose GAPG for push-grasp manipulation in cluttered scenes.",
        pdfTextRaw: `
Abstract
We propose GAPG for push-grasp manipulation in cluttered scenes.
1 Introduction
Push-grasp manipulation remains difficult in cluttered scenes because direct grasps frequently fail under occlusion.
3 Method
GAPG organizes push and grasp into a goal-aware policy with shared decision logic.
5 Experiments
The policy improves execution stability in clutter.
6 Conclusion
The policy improves end-to-end manipulation robustness.
`,
        codeUrl: null,
      },
    });

    expect(openAiCreateMock).toHaveBeenCalledTimes(1);

    const requestPayload = openAiCreateMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = requestPayload.messages.find((message) => message.role === "user");
    const userPayload = JSON.parse(userMessage?.content ?? "{}") as {
      references?: Array<{ id: number; source: string; url: string }>;
    };

    expect(userPayload.references?.[0]).toMatchObject({
      id: 1,
      source: "Paper PDF",
      url: "https://arxiv.org/pdf/2603.12345.pdf",
    });
    expect(userPayload.references?.[1]).toMatchObject({
      id: 2,
      source: "机器之心",
      url: "https://www.jiqizhixin.com/articles/gapg",
    });
    expect(result.paperExplanation?.method).toContain("GAPG");
    expect(result.analysisSummary).toContain("GAPG");
    expect(result.analysisSummary).toContain("[1]");
    expect(result.analysisSummary).toContain("[2]");
  }, 30_000);
});
