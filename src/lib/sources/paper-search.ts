import { buildPaperTopicView } from "@/lib/paper-copy";
import { getTavilyApiKey } from "@/lib/runtime-settings";
import type { EventTag, PaperInput, ReferenceItem } from "@/lib/types";

const SEARCH_REQUEST_TIMEOUT_MS = 6_000;
const EXCLUDED_SOURCE_DOMAINS = [
  "arxiv.org",
  "semanticscholar.org",
  "scholar.google.com",
  "github.com",
  "github.io",
  "huggingface.co",
  "paperswithcode.com",
];

const SOURCE_LABELS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:^|\.)jiqizhixin\.com$/i, label: "机器之心" },
  { pattern: /(?:^|\.)qbitai\.com$/i, label: "量子位" },
  { pattern: /(?:^|\.)zhidx\.com$/i, label: "智东西" },
  { pattern: /(?:^|\.)baai\.ac\.cn$/i, label: "智源" },
  { pattern: /(?:^|\.)36kr\.com$/i, label: "36Kr" },
  { pattern: /(?:^|\.)infoq\.cn$/i, label: "InfoQ" },
  { pattern: /(?:^|\.)csdn\.net$/i, label: "CSDN" },
  { pattern: /(?:^|\.)zhihu\.com$/i, label: "知乎" },
  { pattern: /(?:^|\.)juejin\.cn$/i, label: "掘金" },
  { pattern: /(?:^|\.)oschina\.net$/i, label: "开源中国" },
  { pattern: /(?:^|\.)mp\.weixin\.qq\.com$/i, label: "微信公众号" },
  { pattern: /(?:^|\.)qq\.com$/i, label: "腾讯" },
  { pattern: /(?:^|\.)sohu\.com$/i, label: "搜狐" },
  { pattern: /(?:^|\.)sina\.com\.cn$/i, label: "新浪" },
];

const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "into",
  "of",
  "on",
  "the",
  "to",
  "towards",
  "using",
  "via",
  "with",
  "paper",
  "study",
  "approach",
  "method",
  "model",
  "system",
]);

type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
};

export type PaperChineseReference = ReferenceItem & {
  content: string;
};

type PaperSearchInput = Pick<PaperInput, "paperTitle" | "paperUrl" | "authors" | "abstractRaw" | "pdfTextRaw"> & {
  eventTag: EventTag;
};

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => compactText(value)).filter(Boolean))];
}

function normalizeUrl(value: string | null | undefined) {
  const candidate = compactText(value);

  if (!candidate) {
    return "";
  }

  try {
    return new URL(candidate).toString();
  } catch {
    return "";
  }
}

function containsChinese(value: string) {
  return /[\u4e00-\u9fff]/.test(value);
}

function getSourceLabel(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    const matched = SOURCE_LABELS.find(({ pattern }) => pattern.test(hostname));

    if (matched) {
      return matched.label;
    }

    return hostname;
  } catch {
    return "外链";
  }
}

function extractArxivId(paperUrl: string) {
  const matched = compactText(paperUrl).match(/arxiv\.org\/(?:abs|pdf)\/([^?#/]+)/i);
  return matched?.[1]?.replace(/\.pdf$/i, "") ?? "";
}

function tokenizePaperTitle(paperTitle: string) {
  return compactText(paperTitle)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 4 && !TITLE_STOPWORDS.has(token))
    .slice(0, 6);
}

function buildPrimaryQuery(input: PaperSearchInput) {
  const arxivId = extractArxivId(input.paperUrl);

  return [`"${input.paperTitle}"`, arxivId, input.authors[0], "论文 解读"]
    .filter(Boolean)
    .join(" ");
}

function buildFallbackQueries(input: PaperSearchInput) {
  const arxivId = extractArxivId(input.paperUrl);
  const topicView = buildPaperTopicView({
    paperTitle: input.paperTitle,
    contentRaw: input.pdfTextRaw,
    abstractRaw: input.abstractRaw,
    eventTag: input.eventTag,
  });

  return uniqueStrings([
    arxivId ? `${arxivId} ${input.paperTitle} 论文` : "",
    [topicView.topic, ...topicView.keywords.slice(0, 2), "论文 解读"].filter(Boolean).join(" "),
    [input.authors[0], topicView.topic, "arXiv 论文"].filter(Boolean).join(" "),
  ]);
}

function scoreResult(result: TavilySearchResult, input: PaperSearchInput) {
  const title = compactText(input.paperTitle).toLowerCase();
  const arxivId = extractArxivId(input.paperUrl).toLowerCase();
  const firstAuthor = compactText(input.authors[0]).toLowerCase();
  const titleTokens = tokenizePaperTitle(input.paperTitle);
  const topicView = buildPaperTopicView({
    paperTitle: input.paperTitle,
    contentRaw: input.pdfTextRaw,
    abstractRaw: input.abstractRaw,
    eventTag: input.eventTag,
  });
  const haystack = `${result.title} ${result.content} ${result.url}`.toLowerCase();
  let score = 0;

  if (title && haystack.includes(title)) {
    score += 8;
  }

  if (arxivId && haystack.includes(arxivId)) {
    score += 6;
  }

  for (const token of titleTokens) {
    if (haystack.includes(token)) {
      score += 2;
    }
  }

  if (firstAuthor && haystack.includes(firstAuthor)) {
    score += 1;
  }

  for (const keyword of topicView.keywords) {
    if (keyword && haystack.includes(keyword.toLowerCase())) {
      score += 1;
    }
  }

  if (/(论文|paper|arxiv|预印本|解读|研究)/i.test(result.title) || /(论文|paper|arxiv|预印本|解读|研究)/i.test(result.content)) {
    score += 1;
  }

  return score;
}

async function searchWithTavily(query: string, exactMatch: boolean) {
  const tavilyApiKey = await getTavilyApiKey();

  if (!tavilyApiKey) {
    return [];
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tavilyApiKey}`,
        "User-Agent": "Event2People/1.0",
      },
      body: JSON.stringify({
        query,
        topic: "general",
        country: "china",
        search_depth: "basic",
        max_results: 5,
        include_raw_content: false,
        include_answer: false,
        exclude_domains: EXCLUDED_SOURCE_DOMAINS,
        exact_match: exactMatch,
      }),
      signal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();

    if (!Array.isArray(payload?.results)) {
      return [];
    }

    return payload.results
      .map((result: { title?: string; url?: string; content?: string }) => ({
        title: compactText(result.title),
        url: normalizeUrl(result.url),
        content: compactText(result.content),
      }))
      .filter((result: TavilySearchResult) => result.url && (result.title || result.content));
  } catch {
    return [];
  }
}

export async function fetchPaperChineseReferences(input: PaperSearchInput) {
  const primaryResults = await searchWithTavily(buildPrimaryQuery(input), true);
  let fallbackResults: TavilySearchResult[] = [];

  if (primaryResults.length === 0) {
    for (const query of buildFallbackQueries(input)) {
      fallbackResults = await searchWithTavily(query, false);

      if (fallbackResults.length > 0) {
        break;
      }
    }
  }

  const rankedResults = [...primaryResults, ...fallbackResults]
    .map((result) => ({
      ...result,
      score: scoreResult(result, input),
    }))
    .filter((result) => result.score >= 6 && (containsChinese(result.title) || containsChinese(result.content)))
    .sort((left, right) => right.score - left.score);

  const uniqueResults = rankedResults.filter((result, index, items) => {
    return items.findIndex((candidate) => candidate.url === result.url) === index;
  });

  return uniqueResults.slice(0, 4).map((result) => ({
    label: getSourceLabel(result.url),
    title: result.title || getSourceLabel(result.url),
    url: result.url,
    content: result.content,
  })) satisfies PaperChineseReference[];
}
