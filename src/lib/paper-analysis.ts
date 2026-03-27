import OpenAI from "openai";

import { env, hasOpenAiKey } from "@/lib/env";
import { buildPaperExplanationZh, type PaperExplanationView } from "@/lib/paper-copy";
import { fetchPaperChineseReferences } from "@/lib/sources/paper-search";
import { clampPlainText } from "@/lib/text";
import type { EventTag, ReferenceItem } from "@/lib/types";

const ANALYSIS_CACHE_TTL_MS = 30 * 60_000;
const ANALYSIS_TIMEOUT_MS = 24_000;
const FIELD_LENGTH_LIMIT = 220;

type PaperAnalysisInput = {
  stableId: string;
  eventTitleZh: string;
  eventHighlightZh: string;
  eventTag: EventTag;
  relatedRepoCount?: number | null;
  paper: {
    paperTitle: string;
    paperUrl: string;
    authors: string[];
    abstractRaw: string | null;
    pdfTextRaw: string | null;
    codeUrl: string | null;
  };
};

type PaperAnalysisResult = {
  paperExplanation: PaperExplanationView | null;
  analysisSummary: string | null;
  analysisReferences: ReferenceItem[];
};

let clientSingleton: OpenAI | null | undefined;
const analysisCache = new Map<string, { expiresAt: number; value: PaperAnalysisResult }>();

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

function toPaperPdfUrl(paperUrl: string) {
  const normalized = compactText(paperUrl);

  if (/arxiv\.org\/pdf\//i.test(normalized)) {
    return normalized.endsWith(".pdf") ? normalized : `${normalized}.pdf`;
  }

  if (/arxiv\.org\/abs\//i.test(normalized)) {
    return normalized.replace("/abs/", "/pdf/").replace(/\/?$/, ".pdf");
  }

  return normalized;
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

function normalizeExplanationField(value: string | null | undefined) {
  const normalized = compactText(value);

  if (!normalized) {
    return "";
  }

  return clampPlainText(normalized, FIELD_LENGTH_LIMIT);
}

function isSectionHeading(line: string) {
  return /^(\d+(\.\d+)*)?\s*(abstract|introduction|background|related work|method|methods|approach|framework|methodology|experiment|experiments|evaluation|results|conclusion|conclusions|discussion|limitations|future work|appendix|摘要|引言|背景|方法|实验|结果|结论)\b/i.test(
    line,
  );
}

function buildPdfSectionSnippet(lines: string[], patterns: RegExp[], maxLength = 2200) {
  const startIndex = lines.findIndex((line) => patterns.some((pattern) => pattern.test(line)));

  if (startIndex < 0) {
    return "";
  }

  const collected: string[] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];

    if (index > startIndex && isSectionHeading(line)) {
      break;
    }

    collected.push(line);

    if (collected.join(" ").length >= maxLength) {
      break;
    }
  }

  return clampPlainText(collected.join(" "), maxLength);
}

function buildPaperPdfContext(pdfTextRaw: string | null | undefined) {
  const lines = String(pdfTextRaw ?? "")
    .split(/\n+/)
    .map((line) => compactText(line))
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      abstract: "",
      introduction: "",
      method: "",
      evaluation: "",
      conclusion: "",
    };
  }

  return {
    abstract: buildPdfSectionSnippet(lines, [/^(abstract|摘要)\b/i], 1800),
    introduction: buildPdfSectionSnippet(lines, [/^(\d+(\.\d+)*)?\s*(introduction|background|引言|背景)\b/i], 2200),
    method: buildPdfSectionSnippet(lines, [/^(\d+(\.\d+)*)?\s*(method|methods|approach|framework|methodology|方法)\b/i], 2600),
    evaluation: buildPdfSectionSnippet(lines, [/^(\d+(\.\d+)*)?\s*(experiment|experiments|evaluation|results|实验|结果)\b/i], 2200),
    conclusion: buildPdfSectionSnippet(lines, [/^(\d+(\.\d+)*)?\s*(conclusion|conclusions|discussion|结论)\b/i], 1800),
  };
}

function appendReferenceTags(sentence: string, references: ReferenceItem[], preferredIndexes: number[]) {
  const tags = preferredIndexes
    .filter((index) => references[index])
    .map((index) => `[${index + 1}]`);

  if (tags.length === 0) {
    return sentence;
  }

  return `${sentence} ${[...new Set(tags)].join(" ")}`;
}

function buildFallbackPaperExplanation(input: PaperAnalysisInput, references: ReferenceItem[]) {
  const fallback = buildPaperExplanationZh({
    paperTitle: input.paper.paperTitle,
    contentRaw: input.paper.pdfTextRaw,
    abstractRaw: input.paper.abstractRaw,
    eventTag: input.eventTag,
    hasCode: Boolean(input.paper.codeUrl || (input.relatedRepoCount ?? 0) > 0),
    relatedRepoCount: input.relatedRepoCount,
  });

  return {
    lead: fallback.lead,
    problem: appendReferenceTags(fallback.problem, references, [0]),
    method: appendReferenceTags(fallback.method, references, [0, 1]),
    contribution: appendReferenceTags(fallback.contribution, references, [1, 0]),
  } satisfies PaperExplanationView;
}

function normalizePaperExplanation(
  value:
    | {
        problemZh?: string;
        methodZh?: string;
        contributionZh?: string;
      }
    | null
    | undefined,
  fallback: PaperExplanationView,
) {
  const problem = normalizeExplanationField(value?.problemZh) || fallback.problem;
  const method = normalizeExplanationField(value?.methodZh) || fallback.method;
  const contribution = normalizeExplanationField(value?.contributionZh) || fallback.contribution;

  return {
    lead: clampPlainText([problem, method.replace(/^方法上，/, "")].join(" "), 120),
    problem,
    method,
    contribution,
  } satisfies PaperExplanationView;
}

export async function generatePaperAnalysis(input: PaperAnalysisInput): Promise<PaperAnalysisResult> {
  const cacheKey = `${input.stableId}:${input.paper.paperTitle}`;
  const cached = analysisCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const referencesRaw = await fetchPaperChineseReferences({
    paperTitle: input.paper.paperTitle,
    paperUrl: input.paper.paperUrl,
    authors: input.paper.authors,
    abstractRaw: input.paper.abstractRaw,
    pdfTextRaw: input.paper.pdfTextRaw,
    eventTag: input.eventTag,
  });
  const analysisReferences = [
    {
      label: "Paper PDF",
      title: `${input.paper.paperTitle} PDF`,
      url: toPaperPdfUrl(input.paper.paperUrl),
    },
    ...referencesRaw.map(({ label, title, url }) => ({ label, title, url })),
  ];
  const pdfContext = buildPaperPdfContext(input.paper.pdfTextRaw);
  const fallbackExplanation = buildFallbackPaperExplanation(input, analysisReferences);

  if (!hasOpenAiKey || referencesRaw.length === 0) {
    const fallbackResult = {
      paperExplanation: fallbackExplanation,
      analysisSummary: null,
      analysisReferences,
    };

    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: fallbackResult });
    return fallbackResult;
  }

  const client = getClient();

  if (!client) {
    return {
      paperExplanation: fallbackExplanation,
      analysisSummary: null,
      analysisReferences,
    };
  }

  try {
    const completion = await client.chat.completions.create(
      {
        model: env.openAiModel,
        temperature: 0.2,
        max_completion_tokens: 800,
        messages: [
          {
            role: "system",
            content: [
              "你是 Frontier Event-to-People 的中文研究编辑，负责整理 arXiv 论文卡片。",
              "先以论文 PDF 全文提取出的章节内容为主，再参考中文互联网对论文的介绍做辅助核对，输出清晰易读的三段式中文解读。",
              '输出必须是 JSON，格式为 {"problemZh":"...","methodZh":"...","contributionZh":"..."}。',
              "problemZh 只解释论文解决了什么问题；methodZh 只解释用了什么方法；contributionZh 只解释核心贡献是什么。",
              "每个字段写 1-2 句中文，避免空话和投资判断。",
              "优先使用 [1] 这条 Paper PDF 作为主引用；中文互联网来源只能做补充解释。",
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
                },
                paper: {
                  title: input.paper.paperTitle,
                  url: input.paper.paperUrl,
                  authors: input.paper.authors.slice(0, 4),
                  abstractRaw: compactText(input.paper.abstractRaw),
                  pdfContext,
                  hasCode: Boolean(input.paper.codeUrl || (input.relatedRepoCount ?? 0) > 0),
                },
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
    const payload = JSON.parse(extractJsonPayload(raw)) as {
      problemZh?: string;
      methodZh?: string;
      contributionZh?: string;
    };
    const result = {
      paperExplanation: normalizePaperExplanation(payload, fallbackExplanation),
      analysisSummary: null,
      analysisReferences,
    };

    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: result });
    return result;
  } catch {
    const fallbackResult = {
      paperExplanation: fallbackExplanation,
      analysisSummary: null,
      analysisReferences,
    };

    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: fallbackResult });
    return fallbackResult;
  }
}
