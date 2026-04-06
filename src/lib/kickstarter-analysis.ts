import { clampPlainText } from "@/lib/text";
import type { MetricItem, ReferenceItem } from "@/lib/types";

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

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function metricValue(metrics: MetricItem[], label: string) {
  return metrics.find((metric) => metric.label === label)?.value ?? "";
}

function normalizeAnalysisSummary(value: string) {
  const normalized = value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized ? clampPlainText(normalized, 560) : null;
}

export async function generateKickstarterCampaignAnalysis(
  input: KickstarterAnalysisInput,
): Promise<KickstarterAnalysisResult> {
  const pledged = metricValue(input.metrics, "Pledged");
  const goal = metricValue(input.metrics, "Goal");
  const backers = metricValue(input.metrics, "Backers");
  const status = metricValue(input.metrics, "Days Left") || metricValue(input.metrics, "Status");
  const creators = input.people.slice(0, 2).map((person) => person.name).filter(Boolean).join("、");
  const primarySource = input.sourceLinks[0];
  const references = primarySource
    ? [
        {
          label: primarySource.label,
          title: `${input.eventTitleZh} Kickstarter 原站`,
          url: primarySource.url,
        },
      ]
    : [];

  const paragraphs = [
    `${input.eventTitleZh} 可以先理解成一个面向 ${input.eventTag} 场景的 Kickstarter 项目。${compactText(input.detailSummary) || compactText(input.eventHighlightZh)} 它当前在原站上展示出的核心信息，是把产品形态、目标用户和众筹状态放在同一页里，适合先用来判断这个项目到底是在卖硬件、卖工具链，还是在卖某种具体的 AI 使用方式。`,
    `从这条卡片保留下来的原站数据看，当前筹款进度为 ${pledged || "未知"}${goal ? ` / ${goal}` : ""}，支持人数 ${backers || "未知"}，状态 ${status || "未知"}。${creators ? `当前已识别出的发起人包括 ${creators}。` : "当前卡片里还没有更完整的发起团队信息。"} 这意味着后续继续下钻时，可以优先围绕原站链接、发起人身份和项目交付承诺去判断它的真实成熟度。`,
  ];

  return {
    analysisSummary: normalizeAnalysisSummary(paragraphs.join("\n\n")),
    analysisReferences: references,
  };
}
