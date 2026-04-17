import { getOpenAiClient } from "@/lib/openai-runtime";
import { buildPaperExplanationZh, type PaperExplanationView } from "@/lib/paper-copy";
import { fetchPaperChineseReferences } from "@/lib/sources/paper-search";
import { clampPlainText } from "@/lib/text";
import type { EventTag, ReferenceItem } from "@/lib/types";

const ANALYSIS_CACHE_TTL_MS = 30 * 60_000;
const ANALYSIS_TIMEOUT_MS = 24_000;
const EXPLANATION_FIELD_LENGTH_LIMIT = 320;
const ANALYSIS_PARAGRAPH_LENGTH_LIMIT = 420;
const ANALYSIS_SUMMARY_LENGTH_LIMIT = 1_600;

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

const analysisCache = new Map<string, { expiresAt: number; value: PaperAnalysisResult }>();

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

  return clampPlainText(normalized, EXPLANATION_FIELD_LENGTH_LIMIT);
}

function normalizeAnalysisParagraph(value: string | null | undefined) {
  const normalized = compactText(value);

  if (!normalized) {
    return "";
  }

  return clampPlainText(normalized, ANALYSIS_PARAGRAPH_LENGTH_LIMIT);
}

function clampMultilineText(value: string, limit: number) {
  const normalized = value.trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return normalized.slice(0, limit).trimEnd();
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

function buildPaperPdfReferenceContent(pdfContext: ReturnType<typeof buildPaperPdfContext>) {
  return clampPlainText(
    [
      pdfContext.abstract && `Abstract: ${pdfContext.abstract}`,
      pdfContext.introduction && `Introduction: ${pdfContext.introduction}`,
      pdfContext.method && `Method: ${pdfContext.method}`,
      pdfContext.evaluation && `Evaluation: ${pdfContext.evaluation}`,
      pdfContext.conclusion && `Conclusion: ${pdfContext.conclusion}`,
    ]
      .filter(Boolean)
      .join(" "),
    4_000,
  );
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

function normalizeAnalysisSummary(
  value:
    | {
        analysisParagraphsZh?: string[];
        analysisSummaryZh?: string;
      }
    | null
    | undefined,
  explanation: PaperExplanationView,
) {
  const paragraphsFromArray = Array.isArray(value?.analysisParagraphsZh) ? value.analysisParagraphsZh : [];
  const paragraphsFromString =
    typeof value?.analysisSummaryZh === "string" ? value.analysisSummaryZh.split(/\n{2,}/) : [];
  const normalizedParagraphs = [...paragraphsFromArray, ...paragraphsFromString]
    .map((paragraph) => normalizeAnalysisParagraph(paragraph))
    .filter(Boolean);

  if (normalizedParagraphs.length === 0) {
    return clampMultilineText(
      [explanation.problem, explanation.method, explanation.contribution].filter(Boolean).join("\n\n"),
      ANALYSIS_SUMMARY_LENGTH_LIMIT,
    );
  }

  return clampMultilineText(
    [...new Set(normalizedParagraphs)].slice(0, 4).join("\n\n"),
    ANALYSIS_SUMMARY_LENGTH_LIMIT,
  );
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
  const fallbackResult = {
    paperExplanation: fallbackExplanation,
    analysisSummary: null,
    analysisReferences,
  };
  const { client, config } = await getOpenAiClient({
    timeout: ANALYSIS_TIMEOUT_MS,
    maxRetries: 1,
  });

  if (!client) {
    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: fallbackResult });
    return fallbackResult;
  }

  try {
    const promptReferences = [
      {
        id: 1,
        source: "Paper PDF",
        title: `${input.paper.paperTitle} PDF`,
        url: toPaperPdfUrl(input.paper.paperUrl),
        content: buildPaperPdfReferenceContent(pdfContext),
      },
      ...referencesRaw.map((reference, index) => ({
        id: index + 2,
        source: reference.label,
        title: reference.title,
        url: reference.url,
        content: compactText(reference.content),
      })),
    ];
    const completion = await client.chat.completions.create(
      {
        model: config.model,
        temperature: 0.15,
        max_completion_tokens: 1_300,
        messages: [
          {
            role: "system",
            content: [
              "你是 Frontier Event-to-People 的中文研究编辑，负责整理 arXiv 论文卡片。",
              "这是一篇一篇单独生成的论文解读，不允许套用固定模板句式，不允许泛泛而谈。",
              "先以 [1] 这条 Paper PDF 为主，逐段理解论文问题、方法、实验和结论；如果提供了中文互联网来源，再把这些来源作为补充视角交叉核对。",
              "必须尽量写出该论文自己的方法名、任务对象、实验场景、模块拆分或结论要点；如果拿不到细节，就少写，不要用空洞套话补齐。",
              '输出必须是 JSON，格式为 {"problemZh":"...","methodZh":"...","contributionZh":"...","analysisParagraphsZh":["...","...","..."]}。',
              "problemZh 只解释论文解决了什么问题；methodZh 只解释用了什么方法；contributionZh 只解释核心贡献是什么。",
              "problemZh / methodZh / contributionZh 各写 2-3 句中文，强调论文自身细节，避免空话、投资判断和模板化评价。",
              "analysisParagraphsZh 写 3-4 段，每段 2-4 句，分别覆盖研究背景与问题、方法与关键机制、实验结论与局限/后续价值。",
              "如果用了中文互联网来源，不要只说“有媒体提到”，而要把这些来源强调的具体角度融进表述里。",
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
                  authors: input.paper.authors.slice(0, 6),
                  abstractRaw: compactText(input.paper.abstractRaw),
                  pdfContext,
                  hasCode: Boolean(input.paper.codeUrl || (input.relatedRepoCount ?? 0) > 0),
                },
                references: promptReferences,
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
      analysisParagraphsZh?: string[];
      analysisSummaryZh?: string;
    };
    const paperExplanation = normalizePaperExplanation(payload, fallbackExplanation);
    const result = {
      paperExplanation,
      analysisSummary: normalizeAnalysisSummary(payload, paperExplanation),
      analysisReferences,
    };

    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: result });
    return result;
  } catch {
    analysisCache.set(cacheKey, { expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS, value: fallbackResult });
    return fallbackResult;
  }
}
