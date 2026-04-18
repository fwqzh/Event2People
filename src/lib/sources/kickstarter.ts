import { load } from "cheerio";
import { isValid, parse } from "date-fns";

import { getTavilyApiKey } from "@/lib/runtime-settings";
import { clampPlainText } from "@/lib/text";

const SEARCH_REQUEST_TIMEOUT_MS = 6_000;
const CAMPAIGN_IMAGE_REQUEST_TIMEOUT_MS = 5_000;
const TAVILY_COUNTRY = "United States";
const NEGATIVE_QUERY_SUFFIX = '-"board game" -tabletop -comic -film -book';
const QUERY_BUCKETS: ReadonlyArray<{ query: string; timeRange: "week" | "month" }> = [
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
];
const ALLOWED_PROJECT_SUBPAGES = new Set(["comments", "community", "description", "faq", "faqs", "rewards"]);
const CURRENCY_TOKEN = String.raw`(?:(?:US|CA|AU|NZ|HK|SG)?\$|€|£)\s?[\d,.]+(?:\s?[KMBkmb])?`;
const KICKSTARTER_BODY_MARKERS = [
  /\bis raising funds for\b/i,
  /\bfunding period\b/i,
  /\b(?:pledged|goal|backers?)\b/i,
  /\b\d+\s+(?:days?|hours?)\s+(?:left|to go|remaining)\b/i,
] as const;
const KICKSTARTER_NOISE_LINK_PATTERN =
  /kickstarter\.com\/(?:creators|discover|start|login|signup|about|rules|help|terms|privacy|articles|projects\/[^/]+\/[^/]+\/posts(?:\/\d+)?)/i;
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

type KickstarterCampaignSupplement = {
  startedAt: Date | null;
  startedLabel: string | null;
  imageUrl: string | null;
};

export type KickstarterCampaign = {
  campaignName: string;
  campaignUrl: string;
  imageUrl: string | null;
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

function getKickstarterKeywordHits(text: string) {
  const haystack = text.toLowerCase();

  return {
    aiHits: countKeywordHits(haystack, AI_KEYWORDS),
    hardwareHits: countKeywordHits(haystack, HARDWARE_KEYWORDS),
    consumerElectronicsHits: countKeywordHits(haystack, CONSUMER_ELECTRONICS_KEYWORDS),
  };
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

function normalizeImageUrl(value: string | null | undefined, baseUrl: string) {
  const candidate = compactText(value);

  if (!candidate || candidate.startsWith("data:")) {
    return "";
  }

  try {
    const parsed = new URL(candidate, baseUrl);
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : "";
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
  const { aiHits, hardwareHits, consumerElectronicsHits } = getKickstarterKeywordHits(text);

  return (
    aiHits * 2 +
    hardwareHits * 3 +
    consumerElectronicsHits * 2
  );
}

function isExcludedKickstarterProject(text: string) {
  return countKeywordHits(text.toLowerCase(), EXCLUDED_KEYWORDS) > 0;
}

function isTargetKickstarterProject(text: string, options?: { requireStrongSignal?: boolean }) {
  const haystack = text.toLowerCase();
  const { aiHits, hardwareHits, consumerElectronicsHits } = getKickstarterKeywordHits(haystack);

  if (isExcludedKickstarterProject(haystack)) {
    return false;
  }

  if (options?.requireStrongSignal) {
    return (aiHits > 0 && hardwareHits > 0) || hardwareHits >= 2;
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

function stripKickstarterMarkdownNoise(text: string) {
  return compactText(text)
    .replace(/!\[[^\]]*]\([^)]+\)/gi, " ")
    .replace(/\[([^\]]*)]\(([^)]+)\)/gi, (_, label: string, url: string) => {
      return KICKSTARTER_NOISE_LINK_PATTERN.test(url) ? " " : ` ${label} `;
    })
    .replace(/https?:\/\/[^\s)"']+/gi, " ")
    .replace(/[#*_`>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKickstarterNarrative(text: string) {
  const cleaned = stripKickstarterMarkdownNoise(text);

  if (!cleaned) {
    return "";
  }

  for (const pattern of KICKSTARTER_BODY_MARKERS) {
    const matched = cleaned.match(pattern);

    if (!matched || typeof matched.index !== "number") {
      continue;
    }

    return compactText(cleaned.slice(Math.max(0, matched.index - 120), matched.index + 1_080));
  }

  return compactText(cleaned.slice(0, 960));
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

function isLikelyPreviewImageUrl(url: string) {
  const normalized = compactText(url).toLowerCase();

  if (!normalized) {
    return false;
  }

  if (/\b(avatar|icon|logo|favicon|creator|profile)\b/.test(normalized)) {
    return false;
  }

  return /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(normalized) || /imgix\.net|ksr-ugc/i.test(normalized);
}

function extractPreviewImageUrlFromContent(text: string, campaignUrl: string) {
  const markdownMatch = text.match(/!\[[^\]]*]\(([^)\s]+)\)/i);
  const metaMatch = text.match(/(?:og:image|twitter:image)[^"'<>]{0,120}["'](https?:\/\/[^"'<>]+)["']/i);
  const urlMatches = text.match(/https?:\/\/[^\s"'()<>]+/gi) ?? [];
  const candidates = [
    markdownMatch?.[1],
    metaMatch?.[1],
    ...urlMatches,
  ]
    .map((candidate) => normalizeImageUrl(candidate, campaignUrl))
    .filter(Boolean);

  return candidates.find(isLikelyPreviewImageUrl) ?? null;
}

async function fetchKickstarterCampaignImageUrl(campaignUrl: string) {
  try {
    const response = await fetch(campaignUrl, {
      headers: {
        "User-Agent": "Event2People/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(CAMPAIGN_IMAGE_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const $ = load(html);
    const candidates = [
      $('meta[property="og:image"]').attr("content"),
      $('meta[name="twitter:image"]').attr("content"),
      $('meta[property="og:image:url"]').attr("content"),
      ...$("img[src]")
        .slice(0, 8)
        .map((_, element) => $(element).attr("src"))
        .get(),
    ]
      .map((candidate) => normalizeImageUrl(candidate, campaignUrl))
      .filter(Boolean);

    return candidates.find(isLikelyPreviewImageUrl) ?? null;
  } catch {
    return null;
  }
}

async function enrichKickstarterCampaignImage(campaign: KickstarterCampaign) {
  if (campaign.imageUrl) {
    return campaign;
  }

  const fetchedImageUrl = await fetchKickstarterCampaignImageUrl(campaign.campaignUrl);

  if (!fetchedImageUrl) {
    return campaign;
  }

  return {
    ...campaign,
    imageUrl: fetchedImageUrl,
  };
}

async function fetchKickstarterCampaignSupplement(campaignUrl: string): Promise<KickstarterCampaignSupplement | null> {
  const results = await searchWithTavily(`"${campaignUrl}"`, { maxResults: 8 });

  if (results.length === 0) {
    return null;
  }

  const canonicalMatches = results.filter((result) => normalizeKickstarterCampaignUrl(result.url) === campaignUrl);
  const candidates = canonicalMatches.length > 0 ? canonicalMatches : results;
  let startedAt: Date | null = null;
  let startedLabel: string | null = null;
  let imageUrl: string | null = null;

  for (const candidate of candidates) {
    const content = compactText(candidate.content || candidate.title);

    if (!content) {
      continue;
    }

    if (!startedAt) {
      const nextStartDate = extractStartDate(content);

      if (nextStartDate.startedAt) {
        startedAt = nextStartDate.startedAt;
        startedLabel = nextStartDate.startedLabel;
      }
    }

    if (!imageUrl) {
      imageUrl = extractPreviewImageUrlFromContent(content, campaignUrl);
    }

    if (startedAt && imageUrl) {
      break;
    }
  }

  return startedAt || imageUrl
    ? {
        startedAt,
        startedLabel,
        imageUrl,
      }
    : null;
}

async function enrichKickstarterCampaign(campaign: KickstarterCampaign) {
  let nextCampaign = campaign;

  if (!campaign.startedAt || !campaign.imageUrl) {
    const supplement = await fetchKickstarterCampaignSupplement(campaign.campaignUrl);

    if (supplement) {
      nextCampaign = {
        ...nextCampaign,
        startedAt: nextCampaign.startedAt ?? supplement.startedAt,
        startedLabel: nextCampaign.startedLabel ?? supplement.startedLabel,
        imageUrl: nextCampaign.imageUrl ?? supplement.imageUrl,
      };
    }
  }

  if (!nextCampaign.imageUrl) {
    nextCampaign = await enrichKickstarterCampaignImage(nextCampaign);
  }

  return nextCampaign;
}

export function parseKickstarterCampaignCandidate(
  result: TavilySearchResult,
  now = new Date(),
): KickstarterCampaign | null {
  const campaignUrl = normalizeKickstarterCampaignUrl(result.url);

  if (!campaignUrl) {
    return null;
  }

  const metricsText = compactText(result.content || result.title);
  const narrativeText = extractKickstarterNarrative(result.content || result.title);
  const classificationHaystack = compactText(`${result.title} ${narrativeText} ${campaignUrl}`);

  if (!isTargetKickstarterProject(classificationHaystack)) {
    return null;
  }

  const campaignName = extractCampaignName(result.title, campaignUrl);

  if (!campaignName) {
    return null;
  }

  const creatorName = extractCreatorName(result.title, narrativeText || metricsText);
  const pledged = extractPledgedMetric(metricsText);
  const goal = extractGoalMetric(metricsText);
  const backers = extractBackersMetric(metricsText);
  const daysLeftLabel = extractDaysLeftLabel(metricsText);
  const startDate = extractStartDate(metricsText);
  const statusLabel = getStatusLabel(metricsText, daysLeftLabel);
  const hasFundingSignal =
    pledged.amount !== null || goal.amount !== null || backers.count !== null || Boolean(daysLeftLabel) || Boolean(startDate.startedAt);

  if (!hasFundingSignal && !isTargetKickstarterProject(classificationHaystack, { requireStrongSignal: true })) {
    return null;
  }

  return {
    campaignName,
    campaignUrl,
    imageUrl: extractPreviewImageUrlFromContent(result.content || result.title, campaignUrl),
    creatorName,
    creatorUrl: null,
    startedAt: startDate.startedAt,
    startedLabel: startDate.startedLabel,
    summaryRaw: buildSummary(narrativeText || metricsText || result.title, campaignName),
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
    searchRelevance: Math.max(getSearchRelevance(classificationHaystack), Math.round(result.score * 100)),
  };
}

function pickPreferredCampaign(current: KickstarterCampaign, candidate: KickstarterCampaign) {
  const currentScore =
    Number(current.pledgedAmount ?? -1) +
    Number(current.backersCount ?? 0) +
    (current.summaryRaw ? 1 : 0) +
    (current.creatorName ? 1 : 0) +
    (current.imageUrl ? 1 : 0);
  const candidateScore =
    Number(candidate.pledgedAmount ?? -1) +
    Number(candidate.backersCount ?? 0) +
    (candidate.summaryRaw ? 1 : 0) +
    (candidate.creatorName ? 1 : 0) +
    (candidate.imageUrl ? 1 : 0);

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
      const startedDelta =
        Number(right.startedAt?.getTime() ?? -1) -
        Number(left.startedAt?.getTime() ?? -1);

      if (startedDelta !== 0) {
        return startedDelta;
      }

      if (left.isLive !== right.isLive) {
        return left.isLive ? -1 : 1;
      }

      const pledgedDelta = Number(right.pledgedAmount ?? -1) - Number(left.pledgedAmount ?? -1);

      if (pledgedDelta !== 0) {
        return pledgedDelta;
      }

      const backersDelta = Number(right.backersCount ?? -1) - Number(left.backersCount ?? -1);

      if (backersDelta !== 0) {
        return backersDelta;
      }

      const recencyDelta = right.collectedAt.getTime() - left.collectedAt.getTime();

      if (recencyDelta !== 0) {
        return recencyDelta;
      }

      return right.searchRelevance - left.searchRelevance;
    })
    .slice(0, limit);
}

async function searchWithTavily(query: string, options?: { timeRange?: "week" | "month"; maxResults?: number }) {
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
        ...(options?.timeRange ? { time_range: options.timeRange } : {}),
        search_depth: "advanced",
        max_results: options?.maxResults ?? 12,
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
    const results = await searchWithTavily(bucket.query, { timeRange: bucket.timeRange });

    for (const result of results) {
      const candidate = parseKickstarterCampaignCandidate(result, now);

      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return Promise.all(coalesceKickstarterCampaigns(candidates, limit).map((campaign) => enrichKickstarterCampaign(campaign)));
}
