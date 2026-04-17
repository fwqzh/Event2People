import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("generateKickstarterCampaignAnalysis", () => {
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env.OPENAI_API_KEY = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("openai");
    process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  });

  it("falls back to readable product copy when OpenAI is unavailable", async () => {
    const { generateKickstarterCampaignAnalysis } = await import("@/lib/kickstarter-analysis");

    const result = await generateKickstarterCampaignAnalysis({
      stableId: "event:kickstarter:caira",
      eventTitleZh: "Caira: the intelligent camera of the future",
      eventHighlightZh: "一台把拍摄、识别和即时整理整合到相机里的 AI 影像设备。",
      eventTag: "Video",
      detailSummary: "它主打在拍摄端直接接入 AI 识别与编辑能力，目标场景是创作者和移动内容生产。",
      metrics: [
        { label: "Pledged", value: "$459,668" },
        { label: "Goal", value: "$50,000" },
        { label: "Backers", value: "611" },
        { label: "Status", value: "Live" },
      ],
      sourceLinks: [
        {
          label: "Kickstarter",
          url: "https://www.kickstarter.com/projects/cameraintelligence/caira-worlds-first-ai-native-mirrorless-camera",
        },
        {
          label: "Creator",
          url: "https://www.kickstarter.com/profile/cameraintelligence",
        },
      ],
      people: [
        {
          name: "Camera Intelligence",
          identitySummaryZh: "Kickstarter Creator · 众筹发起人",
        },
      ],
    });

    expect(result.analysisSummary).toBeTruthy();
    expect(result.analysisSummary).not.toContain("可以先理解成");
    expect(result.analysisSummary).not.toContain("这是一个面向");
    expect(result.analysisSummary).toContain("Caira");
    expect(result.analysisSummary).toContain("$459,668");
    expect(result.analysisReferences).toHaveLength(2);
    expect(result.analysisReferences[0]).toMatchObject({
      label: "Kickstarter",
      url: "https://www.kickstarter.com/projects/cameraintelligence/caira-worlds-first-ai-native-mirrorless-camera",
    });
  }, 20_000);

  it("uses OpenAI to generate natural product analysis when configured", async () => {
    const openAiCreateMock = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              analysisSummaryZh:
                "这款 Kickstarter 产品真正想卖的不是一支单纯的录音笔，而是一种把语音采集、整理和后续调用压缩到同一个硬件入口里的工作方式。对经常开会、打电话或移动记录的人来说，它想减少“先录下来，再回头整理”的断点，让语音信息在进入设备的那一刻就开始被结构化处理。\n\n从众筹数据看，用户买单的点显然不只是硬件本身，还包括它承诺的转写与整理体验是否真的足够顺手。现在页面给出的筹款和支持人数，至少说明这不是一个只有概念没有需求的玩具项目，而是已经有人愿意为这套设备化方案提前下单。",
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

    process.env.OPENAI_API_KEY = "test-openai-key";

    const { generateKickstarterCampaignAnalysis } = await import("@/lib/kickstarter-analysis");

    const result = await generateKickstarterCampaignAnalysis({
      stableId: "event:kickstarter:hidock",
      eventTitleZh: "HiDock P1 & P1 mini-AI Voice Recorder for Bluetooth Earphone",
      eventHighlightZh: "一款把录音、转写和耳机使用场景合到一起的 AI 语音设备。",
      eventTag: "Voice",
      detailSummary: "它强调会议、通话和移动记录场景，希望把语音采集和后续整理压缩到同一个硬件入口里。",
      metrics: [
        { label: "Pledged", value: "$320,000" },
        { label: "Goal", value: "$40,000" },
        { label: "Backers", value: "1,280" },
        { label: "Days Left", value: "8 days" },
      ],
      sourceLinks: [
        {
          label: "Kickstarter",
          url: "https://www.kickstarter.com/projects/hidock/hidock-p1-ai-voice-recorder-for-meeting-anywhere",
        },
      ],
      people: [
        {
          name: "HiDock",
          identitySummaryZh: "Kickstarter Creator · 众筹发起人",
        },
      ],
    });

    expect(openAiCreateMock).toHaveBeenCalledTimes(1);

    const requestPayload = openAiCreateMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = requestPayload.messages.find((message) => message.role === "user");
    const userPayload = JSON.parse(userMessage?.content ?? "{}") as {
      event?: { title?: string; tag?: string };
      sourceLinks?: Array<{ label: string; url: string }>;
    };

    expect(userPayload.event).toMatchObject({
      title: "HiDock P1 & P1 mini-AI Voice Recorder for Bluetooth Earphone",
      tag: "Voice",
    });
    expect(userPayload.sourceLinks?.[0]).toMatchObject({
      label: "Kickstarter",
      url: "https://www.kickstarter.com/projects/hidock/hidock-p1-ai-voice-recorder-for-meeting-anywhere",
    });
    expect(result.analysisSummary).toContain("这款 Kickstarter 产品真正想卖的不是一支单纯的录音笔");
    expect(result.analysisSummary).not.toContain("可以先理解成");
  }, 20_000);
});
