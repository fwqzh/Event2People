import OpenAI from "openai";

import { env, hasOpenAiKey } from "@/lib/env";
import { clampPlainText } from "@/lib/text";
import type { MetricItem, ReferenceItem } from "@/lib/types";

const ANALYSIS_CACHE_TTL_MS = 30 * 60_000;
const ANALYSIS_TIMEOUT_MS = 24_000;
const ANALYSIS_MIN_LENGTH = 180;
const ANALYSIS_MAX_LENGTH = 460;

type KickstarterAnalysisInput = {
  stableId: string;
  eventTitleZh: string;
  eventHighlightZh: string;
  eventTag: string;
  detailSummary: string;
  metrics: MetricItem[];
  sourceLinks: Array<{
    label: string;
    url: string;
  }>;
  people: Array<{
    name: string;
    identitySummaryZh: string;
  }>;
};

type KickstarterAnalysisResult = {
  analysisSummary: string | null;
  analysisReferences: ReferenceItem[];
};

let clientSingleton: OpenAI | null | undefined;
const analysisCache = new Map<string, { expiresAt: number; value: KickstarterAnalysisResult }>();

function getClient() {
  if (!hasOpenAiKey) {
    return null;
  }

  if (!clientSingleton) {
    clientSingleton = new OpenAI({
      apiKey: env.openAiApiKey,
      ...(env.openAiBaseUrl ? { baseURL: env.openAiBaseUrl } : {}),
      timeout: ANALYSIS_TIMEOUT_MS,
      maxRetries: 1,
    });
  }

  return clientSingleton;
}

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function contentToString(
  content:
    | string
    | Array<{
        type?: string;
        text?: string;
      }>
    | null
    | undefined,
) {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => part.text ?? "").join("").trim();
}

function extractJsonPayload(raw: string) {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fencedMatch = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = withoutThink.indexOf("{");
  const end = withoutThink.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return withoutThink.slice(start, end + 1);
  }

  return withoutThink;
}

function metricValue(metrics: MetricItem[], label: string) {
  return metrics.find((metric) => metric.label === label)?.value ?? "";
}

function normalizeAnalysisSummary(value: string | null | undefined) {
  const normalized = value
    ?.replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > ANALYSIS_MAX_LENGTH) {
    return clampPlainText(normalized, ANALYSIS_MAX_LENGTH);
  }

  return normalized;
}

function inferProductAngle(input: KickstarterAnalysisInput) {
  const haystack = [input.eventTitleZh, input.eventHighlightZh, input.detailSummary]
    .join(" ")
    .toLowerCase();

  if (/robot|robotics|drone/.test(haystack)) {
    return "它更像是一台把 AI 或自动化能力落到真实动作执行上的机器人设备";
  }

  if (/camera|video|影像|webcam|glasses|display|projector/.test(haystack)) {
    return "它更像是在拍摄、显示或感知链路里加入 AI 处理能力的消费电子产品";
  }

  if (/voice|speech|audio|earbud|microphone|speaker|recorder|translator/.test(haystack)) {
    return "它更像是一款把语音采集、转写、翻译或回放能力做成硬件入口的 AI 设备";
  }

  if (/smart home|home assistant|hub|sensor/.test(haystack)) {
    return "它更像是面向家庭或桌面场景的智能硬件入口";
  }

  return "它更像是把某种 AI 能力压缩进具体硬件形态里的消费电子项目";
}

function buildReferences(input: KickstarterAnalysisInput) {
  return input.sourceLinks.slice(0, 3).map((source, index) => ({
    label: source.label,
    title: index === 0 ? `${input.eventTitleZh} 原站` : `${input.eventTitleZh} ${source.label}`,
    url: source.url,
  }));
}

function buildFallbackAnalysis(input: KickstarterAnalysisInput, references: ReferenceItem[]) {
  const pledged = metricValue(input.metrics, "Pledged");
  const goal = metricValue(input.metrics, "Goal");
  const backers = metricValue(input.metrics, "Backers");
  const status = metricValue(input.metrics, "Days Left") || metricValue(input.metrics, "Status");
  const productAngle = inferProductAngle(input);
  const creators = input.people
    .slice(0, 2)
    .map((person) => person.name)
    .filter(Boolean)
    .join("、");
  const detail = compactText(input.detailSummary);
  const highlight = compactText(input.eventHighlightZh);
  const productHook = detail && detail !== highlight ? detail : highlight;
  const fundingLine = [pledged, goal ? `目标 ${goal}` : "", backers ? `${backers} 位支持者` : "", status ? `目前 ${status}` : ""]
    .filter(Boolean)
    .join("，");
  const sourceHint = references
    .slice(0, 2)
    .map((reference) => reference.label)
    .join("、");

  return [
    `${input.eventTitleZh} 的卖点不只是把“AI”写进标题里，${productAngle}。${productHook || "从现有原站信息看，它强调的是一个能被直接上手使用的产品形态，而不是单独的技术概念。"} 这类项目真正值得看的地方，通常是它把哪一段原本分散的软件能力收束成了用户愿意单独为之购买的一件设备。`,
    `${fundingLine || "当前众筹页保留的进度信息还不算完整"}。${creators ? `页面里已经能对上的发起人是 ${creators}，` : ""}${sourceHint ? `如果还想继续看这个项目，最好直接回到 ${sourceHint} 这些原始来源，重点核对它承诺交付的核心体验、适用场景，以及这些能力到底是依赖真实硬件完成，还是更接近一层附着在设备上的软件服务。` : "如果还想继续看这个项目，最值得核对的是它承诺交付的核心体验是否足够具体，以及这些能力到底是依赖真实硬件完成，还是更接近一层附着在设备上的软件服务。"}`,
  ].join("\n\n");
}

export async function generateKickstarterCampaignAnalysis(
  input: KickstarterAnalysisInput,
): Promise<KickstarterAnalysisResult> {
  const cacheKey = input.stableId;
  const cached = analysisCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const analysisReferences = buildReferences(input);
  const fallback = {
    analysisSummary: normalizeAnalysisSummary(buildFallbackAnalysis(input, analysisReferences)),
    analysisReferences,
  };

  if (!hasOpenAiKey) {
    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: fallback });
    return fallback;
  }

  const client = getClient();

  if (!client) {
    return fallback;
  }

  try {
    const completion = await client.chat.completions.create(
      {
        model: env.openAiModel,
        temperature: 0.45,
        max_completion_tokens: 700,
        messages: [
          {
            role: "system",
            content: [
              "你是 Frontier Event-to-People 的中文产品编辑，读者是投资人、产品负责人和研究型运营。",
              "只基于给定的 Kickstarter 结构化事实写一段产品详细解读。",
              '输出必须是 JSON，格式为 {"analysisSummaryZh":"..."}。',
              `analysisSummaryZh 写 1-2 段，总长度控制在 ${ANALYSIS_MIN_LENGTH}-${ANALYSIS_MAX_LENGTH} 个中文字符附近。`,
              "重点解释这到底是什么产品、解决了什么具体使用场景、它更像硬件入口还是软件能力附着在硬件上，以及当前众筹数据说明了什么阶段。",
              "语言要自然、可读，不要像后台模板。",
              "不要使用这类开头或句式：'可以先理解成'、'这是一个面向'、'当前这条卡片'、'适合先用来判断'、'这意味着后续'。",
              "不要写空泛评价，不要写'值得关注'、'很有潜力'、'形成信号'、'产品形态和目标用户'这类套话。",
              "不要编造规格、发布时间、融资、供应链、测评反馈等未提供事实。",
              "不要输出 Markdown 代码块，不要补充额外说明。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                event: {
                  title: input.eventTitleZh,
                  highlight: input.eventHighlightZh,
                  tag: input.eventTag,
                  detailSummary: input.detailSummary,
                  metrics: input.metrics,
                },
                creators: input.people.slice(0, 3),
                sourceLinks: input.sourceLinks.slice(0, 3),
              },
              null,
              2,
            ),
          },
        ],
      },
      {
        timeout: ANALYSIS_TIMEOUT_MS,
        maxRetries: 1,
      },
    );

    const raw = contentToString(completion.choices[0]?.message?.content);
    const payload = JSON.parse(extractJsonPayload(raw)) as { analysisSummaryZh?: string };
    const result = {
      analysisSummary: normalizeAnalysisSummary(payload.analysisSummaryZh) ?? fallback.analysisSummary,
      analysisReferences,
    };

    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: result });
    return result;
  } catch {
    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: fallback });
    return fallback;
  }
}
