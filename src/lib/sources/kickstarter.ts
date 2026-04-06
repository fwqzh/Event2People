import { isValid, parse } from "date-fns";

import { getTavilyApiKey } from "@/lib/runtime-settings";
import { clampPlainText } from "@/lib/text";

const SEARCH_REQUEST_TIMEOUT_MS = 6_000;
const TAVILY_COUNTRY = "United States";
const NEGATIVE_QUERY_SUFFIX = '-"board game" -tabletop -comic -film -book';
const QUERY_BUCKETS = [
  {
    query: `site:kickstarter.com/projects/ robotics Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    timeRange: "month",
  },
  {
    query: `site:kickstarter.com/projects/ camera Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    timeRange: "month",
  },
  {
    query: `site:kickstarter.com/projects/ earbuds Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    timeRange: "month",
  },
  {
    query: `site:kickstarter.com/projects/ glasses Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    timeRange: "month",
  },
  {
    query: `site:kickstarter.com/projects/ "voice recorder" Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    timeRange: "month",
  },
  {
    query: `site:kickstarter.com/projects/ wearable Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    timeRange: "month",
  },
] as const;
const ALLOWED_PROJECT_SUBPAGES = new Set(["description"]);
const CURRENCY_TOKEN = String.raw`(?:(?:US|CA|AU|NZ|HK|SG)?\$|€|£)\s?[\d,.]+(?:\s?[KMBkmb])?`;
const AI_KEYWORDS = [
  "ai",
  "artificial intelligence",
  "llm",
  "ai assistant",
  "ai companion",
  "ai device",
  "ai hardware",
  "on-device ai",
  "local ai",
  "voice ai",
  "vision ai",
  "assistant",
  "copilot",
  "agent",
] as const;
const HARDWARE_KEYWORDS = [
  "hardware",
  "robot",
  "robotics",
  "drone",
  "wearable",
  "smart glasses",
  "glasses",
  "headset",
  "earbud",
  "earbuds",
  "speaker",
  "microphone",
  "camera",
  "webcam",
  "projector",
  "display",
  "screen",
  "consumer electronics",
  "smart home",
  "home assistant",
  "portable ssd",
  "translator",
  "voice recorder",
  "smart ring",
  "smartwatch",
  "gadget",
  "device",
  "sensor",
  "dock",
  "charger",
] as const;
const CONSUMER_ELECTRONICS_KEYWORDS = [
  "consumer electronics",
  "wearable",
  "smart home",
  "glasses",
  "headset",
  "earbuds",
  "speaker",
  "microphone",
  "camera",
  "projector",
  "display",
  "voice recorder",
  "translator",
  "portable ssd",
  "gadget",
] as const;
const EXCLUDED_KEYWORDS = [
  "board game",
  "tabletop",
  "video game",
  "card game",
  "miniatures",
  "rpg",
  "ttrpg",
  "mmorpg",
  "comic",
  "manga",
  "graphic novel",
  "novel",
  "book launch",
  "feature film",
  "short film",
  "film",
  "movie",
  "album",
  "soundtrack",
  "tarot",
  "zine",
  "playmat",
  "expansion",
] as const;

type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score: number;
};

export type KickstarterCampaign = {
  campaignName: string;
  campaignUrl: string;
  creatorName: string;
  creatorUrl: string | null;
  startedAt: Date | null;
  startedLabel: string | null;
  summaryRaw: string;
  pledgedAmount: number | null;
  pledgedLabel: string;
  goalAmount: number | null;
  goalLabel: string;
  backersCount: number | null;
  backersLabel: string;
  statusLabel: string;
  daysLeftLabel: string | null;
  isLive: boolean;
  collectedAt: Date;
  searchRelevance: number;
};

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasKeyword(text: string, keyword: string) {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`, "i").test(text);
}

function countKeywordHits(text: string, keywords: readonly string[]) {
  return keywords.reduce((count, keyword) => count + (hasKeyword(text, keyword) ? 1 : 0), 0);
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

export function normalizeKickstarterCampaignUrl(value: string | null | undefined) {
  const candidate = normalizeUrl(value);

  if (!candidate) {
    return "";
  }

  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.replace(/^www\./i, "");

    if (hostname !== "kickstarter.com") {
      return "";
    }

    const segments = parsed.pathname.split("/").filter(Boolean);

    if (segments[0] !== "projects" || segments.length < 3) {
      return "";
    }

    if (segments.length > 4) {
      return "";
    }

    if (segments.length === 4 && !ALLOWED_PROJECT_SUBPAGES.has(segments[3])) {
      return "";
    }

    return `https://www.kickstarter.com/projects/${segments[1]}/${segments[2]}`;
  } catch {
    return "";
  }
}

function parseHumanNumber(value: string | null | undefined) {
  const normalized = compactText(value).replace(/,/g, "");
  const matched = normalized.match(/(\d+(?:\.\d+)?)(?:\s*([kmb]))?/i);

  if (!matched) {
    return null;
  }

  const base = Number(matched[1]);

  if (!Number.isFinite(base)) {
    return null;
  }

  const suffix = matched[2]?.toLowerCase();

  if (suffix === "k") {
    return Math.round(base * 1_000);
  }

  if (suffix === "m") {
    return Math.round(base * 1_000_000);
  }

  if (suffix === "b") {
    return Math.round(base * 1_000_000_000);
  }

  return Math.round(base);
}

function extractMetricLabel(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const matched = text.match(pattern);

    if (!matched) {
      continue;
    }

    return compactText(matched[1]);
  }

  return "";
}

function extractMonetaryMetric(text: string, patterns: RegExp[]) {
  const label = extractMetricLabel(text, patterns);

  if (!label) {
    return { amount: null, label: "" };
  }

  const normalizedLabel = label.replace(/[.,;:!?]+$/g, "").trim();

  return {
    amount: parseHumanNumber(normalizedLabel),
    label: normalizedLabel.replace(/\s+/g, ""),
  };
}

function extractPledgedMetric(text: string) {
  const pledgedOrFunded = extractMonetaryMetric(text, [
    new RegExp(`(${CURRENCY_TOKEN})\\s+pledged`, "i"),
    new RegExp(`pledged\\s+(?:of\\s+)?(${CURRENCY_TOKEN})`, "i"),
    new RegExp(`(${CURRENCY_TOKEN})\\s+funded`, "i"),
    new RegExp(`funded\\s+(?:of\\s+)?(${CURRENCY_TOKEN})`, "i"),
  ]);

  if (pledgedOrFunded.amount !== null) {
    return pledgedOrFunded;
  }

  const raisedMatch = text.match(new RegExp(`(.{0,80})(${CURRENCY_TOKEN})\\s+raised(.{0,80})`, "i"));

  if (raisedMatch) {
    const context = `${raisedMatch[1]} ${raisedMatch[3]}`;

    if (
      /(goal|backers?|days?\s+(?:left|to go|remaining)|hours?\s+(?:left|to go|remaining)|all or nothing|funding period)/i.test(
        context,
      ) &&
      !/(successful kickstarter projects|projects with|stretch goal)/i.test(context)
    ) {
      return {
        amount: parseHumanNumber(raisedMatch[2]),
        label: compactText(raisedMatch[2]).replace(/[.,;:!?]+$/g, "").replace(/\s+/g, ""),
      };
    }
  }

  return { amount: null, label: "" };
}

function extractGoalMetric(text: string) {
  return extractMonetaryMetric(text, [
    new RegExp(`goal(?:\\s+of)?\\s+(${CURRENCY_TOKEN})`, "i"),
    new RegExp(`(${CURRENCY_TOKEN})\\s+goal`, "i"),
  ]);
}

function extractBackersMetric(text: string) {
  const label = extractMetricLabel(text, [/([\d,.]+(?:\s?[KMBkmb])?)\s+backers?/i]);

  if (!label) {
    return { count: null, label: "" };
  }

  return {
    count: parseHumanNumber(label),
    label,
  };
}

function extractDaysLeftLabel(text: string) {
  const dayMatch = text.match(/(\d+)\s+days?\s+(?:left|to go|remaining)/i);

  if (dayMatch?.[1]) {
    return `${dayMatch[1]} days`;
  }

  const hourMatch = text.match(/(\d+)\s+hours?\s+(?:left|to go|remaining)/i);

  if (hourMatch?.[1]) {
    return `${hourMatch[1]} hours`;
  }

  return null;
}

function parseKickstarterDate(value: string) {
  const candidate = compactText(value).replace(/\s+/g, " ");
  const patterns = ["MMM d yyyy", "MMM d, yyyy", "MMMM d yyyy", "MMMM d, yyyy"];

  for (const pattern of patterns) {
    const parsed = parse(candidate, pattern, new Date());

    if (isValid(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractStartDate(text: string) {
  const monthToken =
    "(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)";
  const dateToken = `(${monthToken}\\s+\\d{1,2},?\\s+\\d{4})`;
  const fundingPeriodMatch = text.match(new RegExp(`funding period\\s+${dateToken}\\s*-\\s*(?:${monthToken}\\s+\\d{1,2},?\\s+\\d{4})`, "i"));

  if (!fundingPeriodMatch?.[1]) {
    return { startedAt: null, startedLabel: null };
  }

  const startedAt = parseKickstarterDate(fundingPeriodMatch[1]);

  if (!startedAt) {
    return { startedAt: null, startedLabel: null };
  }

  return {
    startedAt,
    startedLabel: fundingPeriodMatch[1].replace(/\s+/g, " ").trim(),
  };
}

function getStatusLabel(text: string, daysLeftLabel: string | null) {
  if (daysLeftLabel || /\blive\b|back this project|pledge/i.test(text)) {
    return "Live";
  }

  if (/upcoming|launching soon|pre-launch/i.test(text)) {
    return "Upcoming";
  }

  if (/successfully funded|campaign ended|ended\b|funded on/i.test(text)) {
    return "Ended";
  }

  return "Unknown";
}

function getSearchRelevance(text: string) {
  const haystack = text.toLowerCase();

  return (
    countKeywordHits(haystack, AI_KEYWORDS) * 2 +
    countKeywordHits(haystack, HARDWARE_KEYWORDS) * 3 +
    countKeywordHits(haystack, CONSUMER_ELECTRONICS_KEYWORDS) * 2
  );
}

function isExcludedKickstarterProject(text: string) {
  return countKeywordHits(text.toLowerCase(), EXCLUDED_KEYWORDS) > 0;
}

function isTargetKickstarterProject(text: string) {
  const haystack = text.toLowerCase();
  const aiHits = countKeywordHits(haystack, AI_KEYWORDS);
  const hardwareHits = countKeywordHits(haystack, HARDWARE_KEYWORDS);
  const consumerElectronicsHits = countKeywordHits(haystack, CONSUMER_ELECTRONICS_KEYWORDS);

  if (isExcludedKickstarterProject(haystack)) {
    return false;
  }

  if (consumerElectronicsHits > 0 && hardwareHits > 0) {
    return true;
  }

  if (aiHits > 0 && hardwareHits > 0) {
    return true;
  }

  return hardwareHits >= 2;
}

function decodeSlugFromUrl(url: string) {
  const normalized = normalizeKickstarterCampaignUrl(url);

  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(normalized);
    const slug = parsed.pathname.split("/").filter(Boolean)[2] ?? "";
    return slug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

function cleanKickstarterTitle(title: string) {
  return compactText(title)
    .replace(/^(?:Comments|Updates|Rewards)\s+»\s+/i, "")
    .replace(/\s+[|·•-]\s+Kickstarter.*$/i, "")
    .replace(/\s+[—-]\s+Kickstarter.*$/i, "")
    .trim();
}

function extractCampaignName(title: string, url: string) {
  const cleaned = cleanKickstarterTitle(title);
  const byIndex = cleaned.search(/\s+by\s+/i);

  if (byIndex > 0) {
    return cleaned.slice(0, byIndex).trim();
  }

  return cleaned || decodeSlugFromUrl(url);
}

function extractCreatorName(title: string, text: string) {
  const cleaned = cleanKickstarterTitle(title);
  const titleMatch = cleaned.match(/\bby\s+(.+)$/i);

  if (titleMatch?.[1]) {
    return compactText(titleMatch[1]);
  }

  const textMatch = text.match(/\bby\s+([A-Z][A-Za-z0-9.' -]{2,80})\b/);
  return compactText(textMatch?.[1]);
}

function buildSummary(text: string, campaignName: string) {
  const normalized = compactText(text)
    .replace(/\s+/g, " ")
    .replace(new RegExp(campaignName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), campaignName)
    .trim();

  if (!normalized) {
    return "";
  }

  const withoutMetrics = normalized
    .replace(/\b\d[\d,.]*\s+backers?\b/gi, "")
    .replace(new RegExp(CURRENCY_TOKEN, "gi"), "")
    .replace(/\b(?:pledged|raised|goal|days?|hours?|left|to go|remaining|live|ended|upcoming)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return clampPlainText(withoutMetrics || normalized, 280);
}

export function parseKickstarterCampaignCandidate(
  result: TavilySearchResult,
  now = new Date(),
): KickstarterCampaign | null {
  const campaignUrl = normalizeKickstarterCampaignUrl(result.url);

  if (!campaignUrl) {
    return null;
  }

  const haystack = `${result.title} ${result.content} ${campaignUrl}`;

  if (!isTargetKickstarterProject(haystack)) {
    return null;
  }

  const campaignName = extractCampaignName(result.title, campaignUrl);

  if (!campaignName) {
    return null;
  }

  const creatorName = extractCreatorName(result.title, haystack);
  const pledged = extractPledgedMetric(haystack);
  const goal = extractGoalMetric(haystack);
  const backers = extractBackersMetric(haystack);
  const daysLeftLabel = extractDaysLeftLabel(haystack);
  const startDate = extractStartDate(haystack);
  const statusLabel = getStatusLabel(haystack, daysLeftLabel);

  if (pledged.amount === null) {
    return null;
  }

  return {
    campaignName,
    campaignUrl,
    creatorName,
    creatorUrl: null,
    startedAt: startDate.startedAt,
    startedLabel: startDate.startedLabel,
    summaryRaw: buildSummary(result.content || result.title, campaignName),
    pledgedAmount: pledged.amount,
    pledgedLabel: pledged.label,
    goalAmount: goal.amount,
    goalLabel: goal.label,
    backersCount: backers.count,
    backersLabel: backers.label,
    statusLabel,
    daysLeftLabel,
    isLive: statusLabel === "Live",
    collectedAt: now,
    searchRelevance: Math.max(getSearchRelevance(haystack), Math.round(result.score * 100)),
  };
}

function pickPreferredCampaign(current: KickstarterCampaign, candidate: KickstarterCampaign) {
  const currentScore =
    Number(current.pledgedAmount ?? -1) +
    Number(current.backersCount ?? 0) +
    (current.summaryRaw ? 1 : 0) +
    (current.creatorName ? 1 : 0);
  const candidateScore =
    Number(candidate.pledgedAmount ?? -1) +
    Number(candidate.backersCount ?? 0) +
    (candidate.summaryRaw ? 1 : 0) +
    (candidate.creatorName ? 1 : 0);

  if (candidateScore === currentScore) {
    return candidate.collectedAt.getTime() > current.collectedAt.getTime() ? candidate : current;
  }

  return candidateScore > currentScore ? candidate : current;
}

export function coalesceKickstarterCampaigns(candidates: KickstarterCampaign[], limit = 10) {
  const deduped = new Map<string, KickstarterCampaign>();

  for (const candidate of candidates) {
    const existing = deduped.get(candidate.campaignUrl);
    deduped.set(candidate.campaignUrl, existing ? pickPreferredCampaign(existing, candidate) : candidate);
  }

  return [...deduped.values()]
    .sort((left, right) => {
      const pledgedDelta = Number(right.pledgedAmount ?? -1) - Number(left.pledgedAmount ?? -1);

      if (pledgedDelta !== 0) {
        return pledgedDelta;
      }

      const backersDelta = Number(right.backersCount ?? -1) - Number(left.backersCount ?? -1);

      if (backersDelta !== 0) {
        return backersDelta;
      }

      if (left.isLive !== right.isLive) {
        return left.isLive ? -1 : 1;
      }

      const recencyDelta = right.collectedAt.getTime() - left.collectedAt.getTime();

      if (recencyDelta !== 0) {
        return recencyDelta;
      }

      return right.searchRelevance - left.searchRelevance;
    })
    .slice(0, limit);
}

async function searchWithTavily(query: string, timeRange: "week" | "month") {
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
        country: TAVILY_COUNTRY,
        time_range: timeRange,
        search_depth: "advanced",
        max_results: 12,
        include_raw_content: true,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(`Kickstarter Tavily search failed (${response.status}) for query: ${query}`);
      return [];
    }

    const payload = await response.json();

    if (!Array.isArray(payload?.results)) {
      return [];
    }

    return payload.results
      .map((result: { title?: string; url?: string; content?: string; raw_content?: string; score?: number }) => ({
        title: compactText(result.title),
        url: normalizeUrl(result.url),
        content: compactText(result.raw_content ?? result.content),
        score: typeof result.score === "number" ? result.score : 0,
      }))
      .filter((result: TavilySearchResult) => result.url && (result.title || result.content));
  } catch {
    return [];
  }
}

export async function fetchKickstarterCampaigns(limit = 10) {
  const now = new Date();
  const candidates: KickstarterCampaign[] = [];

  for (const bucket of QUERY_BUCKETS) {
    const results = await searchWithTavily(bucket.query, bucket.timeRange);
    const collectedAt =
      bucket.timeRange === "week" ? now : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (const result of results) {
      const candidate = parseKickstarterCampaignCandidate(result, collectedAt);

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return coalesceKickstarterCampaigns(candidates, limit);
}
