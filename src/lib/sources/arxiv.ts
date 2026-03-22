import { subDays } from "date-fns";
import { XMLParser } from "fast-xml-parser";

import { env } from "@/lib/env";

export type ArxivPaperRecord = {
  rank: number;
  arxivId: string;
  title: string;
  summary: string;
  publishedAt: Date;
  updatedAt: Date;
  authors: string[];
  comment: string;
  categories: string[];
  primaryCategory: string;
  arxivUrl: string;
  pdfUrl: string;
  citationCount: number;
  influentialCitationCount: number;
  semanticScholarUrl: string;
  venueBonus: number;
  recencyBonus: number;
  impactScore: number;
};

type RawArxivPaperRecord = Omit<
  ArxivPaperRecord,
  "rank" | "citationCount" | "influentialCitationCount" | "semanticScholarUrl" | "venueBonus" | "recencyBonus" | "impactScore"
>;

type SemanticScholarPaper = {
  citationCount: number;
  influentialCitationCount: number;
  url: string;
};

type ArxivCache = {
  records: ArxivPaperRecord[];
  updatedAt: number;
};

const SEARCH_PHRASES = [
  "embodied intelligence",
  "embodied AI",
  "embodied agent",
  "vision-language-action",
  "robot manipulation",
  "robot learning",
  "humanoid robot",
  "whole-body humanoid",
  "mobile manipulation",
];

const EMBODIED_CATEGORIES = ["cs.RO", "cs.AI", "cs.CV", "cs.LG", "eess.SY"];
const EMBODIED_KEYWORDS = [
  "robot",
  "robots",
  "humanoid",
  "manipulation",
  "locomotion",
  "teleoperation",
  "navigation",
  "dexterous",
  "vision-language-action",
  "vision language action",
  "vla",
  "embodied",
];

const VENUE_BONUS_RULES: Array<{ pattern: RegExp; bonus: number }> = [
  { pattern: /\bNeurIPS\b/i, bonus: 45 },
  { pattern: /\bICML\b/i, bonus: 45 },
  { pattern: /\bICLR\b/i, bonus: 45 },
  { pattern: /\bRSS\b/i, bonus: 42 },
  { pattern: /\bCoRL\b/i, bonus: 42 },
  { pattern: /\bICRA\b/i, bonus: 42 },
  { pattern: /\bIROS\b/i, bonus: 38 },
  { pattern: /\bCVPR\b/i, bonus: 40 },
  { pattern: /\bICCV\b/i, bonus: 38 },
  { pattern: /\bECCV\b/i, bonus: 38 },
  { pattern: /\bACL\b/i, bonus: 38 },
  { pattern: /\bEMNLP\b/i, bonus: 36 },
];
const ACCEPTANCE_SIGNAL_BONUS = 18;
const MAX_CANDIDATES = 80;
const SEMANTIC_SCHOLAR_BATCH_SIZE = 40;
const ARXIV_HEADERS: HeadersInit = {
  "User-Agent": "Event2People/1.0",
  Accept: "application/atom+xml",
};
const SEMANTIC_SCHOLAR_HEADERS: HeadersInit = {
  "User-Agent": "Event2People/1.0",
  Accept: "application/json",
  "Content-Type": "application/json",
  ...(env.semanticScholarApiKey ? { "x-api-key": env.semanticScholarApiKey } : {}),
};

let arxivCache: ArxivCache | null = null;

function compactText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function buildSubmittedDateWindow(now = new Date()) {
  const start = subDays(now, 30);
  const startUtc = `${start.getUTCFullYear()}${pad2(start.getUTCMonth() + 1)}${pad2(start.getUTCDate())}0000`;
  const endUtc = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}2359`;

  return { startUtc, endUtc };
}

export function buildArxivSearchQuery(now = new Date()) {
  const { startUtc, endUtc } = buildSubmittedDateWindow(now);
  const phraseQuery = SEARCH_PHRASES.map((phrase) => `all:"${phrase}"`).join(" OR ");
  return `(${phraseQuery}) AND submittedDate:[${startUtc} TO ${endUtc}]`;
}

function extractArxivId(idText: string) {
  const normalized = compactText(idText);
  const tail = normalized.split("/").pop() ?? normalized;
  return tail.replace(/v\d+$/i, "");
}

function parseLinks(entry: Record<string, unknown>) {
  const links = Array.isArray(entry.link) ? entry.link : [entry.link].filter(Boolean);
  let arxivUrl = "";
  let pdfUrl = "";

  for (const link of links) {
    const record = (link ?? {}) as { href?: string; rel?: string; title?: string; type?: string };

    if (!arxivUrl && record.rel === "alternate" && record.type === "text/html" && record.href) {
      arxivUrl = record.href;
    }

    if (!pdfUrl && record.title === "pdf" && record.href) {
      pdfUrl = record.href;
    }
  }

  return { arxivUrl, pdfUrl };
}

export function parseArxivAtomXml(xml: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
  });
  const parsed = parser.parse(xml);
  const entries = parsed.feed?.entry ? (Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry]) : [];

  return entries.map((entry: Record<string, unknown>) => {
    const authors = Array.isArray(entry.author) ? entry.author : [entry.author].filter(Boolean);
    const categories = Array.isArray(entry.category) ? entry.category : [entry.category].filter(Boolean);
    const links = parseLinks(entry);
    const arxivId = extractArxivId(String(entry.id ?? ""));
    const primaryCategory = String(((entry["arxiv:primary_category"] as { term?: string } | undefined) ?? {}).term ?? "");

    return {
      arxivId,
      title: compactText(entry.title),
      summary: compactText(entry.summary),
      publishedAt: new Date(String(entry.published)),
      updatedAt: new Date(String(entry.updated)),
      authors: authors
        .map((author) => compactText((author as { name?: string }).name ?? ""))
        .filter(Boolean),
      comment: compactText(entry["arxiv:comment"]),
      categories: categories
        .map((category) => compactText((category as { term?: string }).term ?? ""))
        .filter(Boolean),
      primaryCategory,
      arxivUrl: links.arxivUrl || `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: links.pdfUrl || `https://arxiv.org/pdf/${arxivId}.pdf`,
    } satisfies RawArxivPaperRecord;
  });
}

export function matchesEmbodiedPaper(record: RawArxivPaperRecord) {
  if (record.categories.some((category) => EMBODIED_CATEGORIES.includes(category)) || EMBODIED_CATEGORIES.includes(record.primaryCategory)) {
    return true;
  }

  const haystack = `${record.title} ${record.summary}`.toLowerCase();
  return EMBODIED_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

export function extractVenueBonus(comment: string) {
  const normalized = compactText(comment);
  const venueBonus = VENUE_BONUS_RULES.reduce((maxBonus, rule) => (rule.pattern.test(normalized) ? Math.max(maxBonus, rule.bonus) : maxBonus), 0);
  const hasAcceptanceSignal = /\b(accepted|to appear|camera ready)\b/i.test(normalized);
  return venueBonus + (hasAcceptanceSignal ? ACCEPTANCE_SIGNAL_BONUS : 0);
}

export function computeRecencyBonus(publishedAt: Date, now = new Date()) {
  const ageMs = now.getTime() - publishedAt.getTime();
  const ageDays = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
  return Math.max(0, 96 - ageDays * 3);
}

export function computeImpactScore(
  record: Pick<ArxivPaperRecord, "citationCount" | "influentialCitationCount" | "comment" | "publishedAt">,
  now = new Date(),
) {
  const venueBonus = extractVenueBonus(record.comment);
  const recencyBonus = computeRecencyBonus(record.publishedAt, now);
  const impactScore = record.citationCount * 20 + record.influentialCitationCount * 35 + venueBonus + recencyBonus;

  return {
    venueBonus,
    recencyBonus,
    impactScore,
  };
}

async function fetchArxivCandidates(now = new Date()) {
  const params = new URLSearchParams({
    search_query: buildArxivSearchQuery(now),
    sortBy: "submittedDate",
    sortOrder: "descending",
    start: "0",
    max_results: String(MAX_CANDIDATES),
  });
  const response = await fetch(`https://export.arxiv.org/api/query?${params.toString()}`, {
    headers: ARXIV_HEADERS,
    next: { revalidate: 60 * 30 },
  });

  if (!response.ok) {
    throw new Error(`arXiv fetch failed: ${response.status}`);
  }

  return parseArxivAtomXml(await response.text()).filter(matchesEmbodiedPaper);
}

async function fetchSemanticScholarBatch(ids: string[]) {
  const response = await fetch("https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount,influentialCitationCount,url", {
    method: "POST",
    headers: SEMANTIC_SCHOLAR_HEADERS,
    body: JSON.stringify({ ids }),
    next: { revalidate: 60 * 60 },
  });

  if (!response.ok) {
    throw new Error(`Semantic Scholar batch fetch failed: ${response.status}`);
  }

  return (await response.json()) as Array<{ citationCount?: number; influentialCitationCount?: number; url?: string } | null>;
}

async function enrichWithSemanticScholar(records: RawArxivPaperRecord[]) {
  if (records.length === 0) {
    return [];
  }

  const metrics = new Map<string, SemanticScholarPaper>();

  try {
    for (let start = 0; start < records.length; start += SEMANTIC_SCHOLAR_BATCH_SIZE) {
      const chunk = records.slice(start, start + SEMANTIC_SCHOLAR_BATCH_SIZE);
      const ids = chunk.map((record) => `ARXIV:${record.arxivId}`);
      const response = await fetchSemanticScholarBatch(ids);

      response.forEach((item, index) => {
        metrics.set(chunk[index].arxivId, {
          citationCount: item?.citationCount ?? 0,
          influentialCitationCount: item?.influentialCitationCount ?? 0,
          url: item?.url ?? "",
        });
      });
    }
  } catch (error) {
    console.warn("Semantic Scholar fallback:", error instanceof Error ? error.message : "unknown fetch error");
  }

  return records.map((record) => {
    const paperMetrics = metrics.get(record.arxivId) ?? {
      citationCount: 0,
      influentialCitationCount: 0,
      url: "",
    };
    const score = computeImpactScore(
      {
        citationCount: paperMetrics.citationCount,
        influentialCitationCount: paperMetrics.influentialCitationCount,
        comment: record.comment,
        publishedAt: record.publishedAt,
      },
      new Date(),
    );

    return {
      ...record,
      rank: 0,
      citationCount: paperMetrics.citationCount,
      influentialCitationCount: paperMetrics.influentialCitationCount,
      semanticScholarUrl: paperMetrics.url,
      venueBonus: score.venueBonus,
      recencyBonus: score.recencyBonus,
      impactScore: score.impactScore,
    } satisfies ArxivPaperRecord;
  });
}

export async function fetchArxivPapers(limit = 10) {
  try {
    const candidates = await fetchArxivCandidates();
    const enriched = await enrichWithSemanticScholar(candidates);
    const topRecords = enriched
      .sort(
        (left, right) =>
          right.impactScore - left.impactScore ||
          right.influentialCitationCount - left.influentialCitationCount ||
          right.citationCount - left.citationCount ||
          right.publishedAt.getTime() - left.publishedAt.getTime(),
      )
      .slice(0, limit)
      .map((record, index) => ({
        ...record,
        rank: index + 1,
      }));

    if (topRecords.length > 0) {
      arxivCache = {
        records: topRecords,
        updatedAt: Date.now(),
      };
      return topRecords;
    }
  } catch (error) {
    console.warn("arXiv embodied ranking fallback:", error instanceof Error ? error.message : "unknown fetch error");
  }

  if (arxivCache) {
    return arxivCache.records.slice(0, limit);
  }

  throw new Error("arXiv fetch failed and no cached result is available");
}
