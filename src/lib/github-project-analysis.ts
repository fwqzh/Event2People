import { getOpenAiClient } from "@/lib/openai-runtime";
import { fetchGitHubProjectChineseReferences } from "@/lib/sources/github-project-search";
import { clampPlainText, repoDisplayName } from "@/lib/text";
import type { MetricItem, ReferenceItem } from "@/lib/types";

const ANALYSIS_CACHE_TTL_MS = 30 * 60_000;
const ANALYSIS_TIMEOUT_MS = 24_000;
const ANALYSIS_MIN_LENGTH = 240;
const ANALYSIS_MAX_LENGTH = 560;

type AnalysisInput = {
  stableId: string;
  eventTitleZh: string;
  eventHighlightZh: string;
  eventTag: string;
  detailSummary: string;
  metrics: MetricItem[];
  project: {
    repoName: string;
    ownerName: string;
    repoDescriptionRaw: string | null;
    readmeExcerptRaw: string | null;
  };
  people: Array<{
    name: string;
    contributionCount: number;
    identitySummaryZh: string;
  }>;
};

type AnalysisResult = {
  analysisSummary: string | null;
  analysisReferences: ReferenceItem[];
};

const analysisCache = new Map<string, { expiresAt: number; value: AnalysisResult }>();

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

function buildFallbackAnalysis(input: AnalysisInput, references: ReferenceItem[]) {
  const displayName = repoDisplayName(input.project.repoName) || input.eventTitleZh;
  const metricsHint = input.metrics.map((metric) => `${metric.label}${metric.value}`).join("，");
  const peopleHint = input.people
    .slice(0, 2)
    .map((person) => person.name)
    .join("、");
  const sourceHint = references
    .slice(0, 2)
    .map((reference, index) => `${reference.title}[${index + 1}]`)
    .join("、");

  return [
    `${displayName} 可以先理解成一类 ${input.eventTag} 项目。结合仓库原始说明，它不是只展示一个零散功能，而是试图把“${compactText(input.project.repoDescriptionRaw) || input.eventHighlightZh}”这段能力做成可直接运行、可被复用的开源实现。对做判断的人来说，更重要的是先分清它到底是上层应用、开发者工具，还是能嵌进现有系统里的基础模块。`,
    compactText(input.project.readmeExcerptRaw)
      ? `从 README 暴露出来的重点看，它更像在补齐某条工作流里最难工程化的一段，例如运行时、编排、工具调用、评测闭环或特定场景执行。也因此，理解它时不要只看一句 repo slogan，而要看它把哪些步骤真正串成了一条可执行链路；当前这条 event 给出的 ${metricsHint}，能帮助判断这套实现最近是不是已经被更多人拿去试。`
      : `如果把它放到更大的产品栈里看，关键在于判断它落在哪一层，以及它解决的是“能力缺失”还是“流程断裂”的问题。当前这条 event 给出的 ${metricsHint}，能帮助判断这套实现最近是不是已经被更多人拿去试。`,
    `中文互联网里，与它相关的解释目前主要来自 ${sourceHint || "现有公开来源"}，这些来源提供的是“外部如何理解它”的视角。再结合当前已映射出的人物${peopleHint ? `，例如 ${peopleHint}` : ""}，更适合继续判断这个项目背后是否已经形成持续推进该方向的核心建设者。`,
  ].join("\n\n");
}

export async function generateGitHubProjectAnalysis(input: AnalysisInput): Promise<AnalysisResult> {
  const cacheKey = `${input.stableId}:${input.project.repoName}`;
  const cached = analysisCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const referencesRaw = await fetchGitHubProjectChineseReferences({
    repoName: input.project.repoName,
    ownerName: input.project.ownerName,
    repoDescriptionRaw: input.project.repoDescriptionRaw,
  });
  const analysisReferences = referencesRaw.map(({ label, title, url }) => ({ label, title, url }));

  const fallback = {
    analysisSummary: normalizeAnalysisSummary(buildFallbackAnalysis(input, analysisReferences)),
    analysisReferences,
  };

  if (referencesRaw.length === 0) {
    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: fallback });
    return fallback;
  }

  const { client, config } = await getOpenAiClient({
    timeout: ANALYSIS_TIMEOUT_MS,
    maxRetries: 1,
  });

  if (!client) {
    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: fallback });
    return fallback;
  }

  try {
    const completion = await client.chat.completions.create(
      {
        model: config.model,
        temperature: 0.3,
        max_completion_tokens: 900,
        messages: [
          {
            role: "system",
            content: [
              "你是 Frontier Event-to-People 的中文研究编辑，读者是 VC、产品负责人和研究型运营。",
              "只基于给定事实和中文互联网引用写项目详细解读。",
              '输出必须是 JSON，格式为 {"analysisSummaryZh":"..."}。',
              `analysisSummaryZh 写 2-3 段，总长度控制在 ${ANALYSIS_MIN_LENGTH}-${ANALYSIS_MAX_LENGTH} 个中文字符附近。`,
              "重点解释：这是什么项目、它位于什么产品/技术层、核心工作流是什么、适合什么场景。",
              "不要写投资建议、市场规模、融资、估值、竞争结论，不要写“值得关注”“很有潜力”之类空话。",
              "只允许引用提供的 references，并在句内用 [1] [2] [3] 这样的编号。",
              "不要引用未提供的编号，不要编造来源，不要输出 Markdown 代码块。",
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
                project: {
                  repoName: input.project.repoName,
                  repoDisplayName: repoDisplayName(input.project.repoName),
                  ownerName: input.project.ownerName,
                  repoDescriptionRaw: compactText(input.project.repoDescriptionRaw),
                  readmeExcerptRaw: compactText(input.project.readmeExcerptRaw),
                },
                people: input.people.slice(0, 3),
                references: referencesRaw.map((reference, index) => ({
                  id: index + 1,
                  source: reference.label,
                  title: reference.title,
                  url: reference.url,
                  content: compactText(reference.content),
                })),
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
      analysisSummary:
        normalizeAnalysisSummary(payload.analysisSummaryZh) ??
        normalizeAnalysisSummary(buildFallbackAnalysis(input, analysisReferences)),
      analysisReferences,
    };

    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: result });
    return result;
  } catch {
    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: fallback });
    return fallback;
  }
}
