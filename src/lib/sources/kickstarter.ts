import { load } from "cheerio";
import { format, isValid, parse } from "date-fns";

import { KICKSTARTER_MIN_PLEDGED_USD, KICKSTARTER_PRE_ENRICH_POOL_LIMIT } from "@/lib/kickstarter-config";
import { getTavilyApiKey } from "@/lib/runtime-settings";
import { clampPlainText } from "@/lib/text";

const SEARCH_REQUEST_TIMEOUT_MS = 6_000;
const CAMPAIGN_IMAGE_REQUEST_TIMEOUT_MS = 5_000;
const DISCOVER_REQUEST_TIMEOUT_MS = 60_000;
const DISCOVER_SETTLE_DELAY_MS = 5_000;
const TAVILY_COUNTRY = "United States";
const KICKSTARTER_DISCOVER_NEWEST_URL = "https://www.kickstarter.com/discover/advanced?category_id=16&sort=newest";
const KICKSTARTER_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const KICKSTARTER_DISCOVER_URL_LIMIT = 12;
const KICKSTARTER_DISCOVER_PAGE_LIMIT = 5;
const NEGATIVE_QUERY_SUFFIX = '-"board game" -tabletop -comic -film -book';
const RECENT_DISCOVERY_WINDOWS = [
  {
    timeRange: "week",
    maxResults: 12,
  },
  {
    timeRange: "month",
    maxResults: 8,
  },
] as const;
const EXTENDED_DISCOVERY_WINDOWS = [
  {
    timeRange: "year",
    maxResults: 12,
  },
] as const;
const SEARCH_PLANS = [
  {
    query: `site:kickstarter.com/projects/ robotics Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    windows: RECENT_DISCOVERY_WINDOWS,
  },
  {
    query: `site:kickstarter.com/projects/ camera Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    windows: RECENT_DISCOVERY_WINDOWS,
  },
  {
    query: `site:kickstarter.com/projects/ earbuds Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    windows: RECENT_DISCOVERY_WINDOWS,
  },
  {
    query: `site:kickstarter.com/projects/ glasses Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    windows: RECENT_DISCOVERY_WINDOWS,
  },
  {
    query: `site:kickstarter.com/projects/ "voice recorder" Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    windows: RECENT_DISCOVERY_WINDOWS,
  },
  {
    query: `site:kickstarter.com/projects/ wearable Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    windows: RECENT_DISCOVERY_WINDOWS,
  },
  {
    query: `site:kickstarter.com/projects/ "ai glasses" Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    windows: EXTENDED_DISCOVERY_WINDOWS,
  },
  {
    query: `site:kickstarter.com/projects/ "ai earbuds" Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    windows: EXTENDED_DISCOVERY_WINDOWS,
  },
  {
    query: `site:kickstarter.com/projects/ "ai wearable" Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    windows: EXTENDED_DISCOVERY_WINDOWS,
  },
  {
    query: `site:kickstarter.com/projects/ "ai camera" Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    windows: EXTENDED_DISCOVERY_WINDOWS,
  },
  {
    query: `site:kickstarter.com/projects/ "ai voice recorder" Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    windows: EXTENDED_DISCOVERY_WINDOWS,
  },
  {
    query: `site:kickstarter.com/projects/ "ai audio" Kickstarter ${NEGATIVE_QUERY_SUFFIX}`,
    windows: EXTENDED_DISCOVERY_WINDOWS,
  },
] as const;
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

type KickstarterDiscoverProjectRecord = {
  name: string;
  blurb: string;
  goalAmount: number | null;
  pledgedAmount: number | null;
  state: string;
  slug: string;
  currency: string | null;
  currencySymbol: string | null;
  deadlineAt: Date | null;
  startedAt: Date | null;
  backersCount: number | null;
  creatorName: string | null;
  creatorUrl: string | null;
  imageUrl: string | null;
};

type KickstarterDiscoverProjectEntry = {
  campaignName: string;
  campaignUrl: string;
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

type KickstarterStructuredMetadata = {
  creatorName: string | null;
  imageUrl: string | null;
  pledgedAmount: number | null;
  pledgedLabel: string;
  goalAmount: number | null;
  goalLabel: string;
  backersCount: number | null;
  backersLabel: string;
  startedAt: Date | null;
  startedLabel: string | null;
  summaryRaw: string;
};

type KickstarterCandidateParseOptions = {
  trustTechnologySource?: boolean;
};

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function mergeTavilySearchContent(content: string | null | undefined, rawContent: string | null | undefined) {
  const snippet = compactText(content);
  const raw = compactText(rawContent);

  if (!snippet) {
    return raw;
  }

  if (!raw) {
    return snippet;
  }

  if (snippet === raw || snippet.includes(raw)) {
    return snippet;
  }

  if (raw.includes(snippet)) {
    return raw;
  }

  return compactText(`${snippet}\n\n${raw}`);
}

function formatKickstarterStartedLabel(date: Date | null) {
  return date ? format(date, "MMM d yyyy") : null;
}

function formatUsdLabel(amount: number | null) {
  return amount === null ? "" : `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)}`;
}

function decodeKickstarterHtmlEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function formatKickstarterCurrencyLabel(amount: number | null, currency: string | null, currencySymbol: string | null) {
  if (amount === null) {
    return "";
  }

  const code = compactText(currency).toUpperCase();
  const symbol = compactText(currencySymbol);
  const prefix =
    symbol && symbol !== "$"
      ? symbol
      : ({
          USD: "$",
          CAD: "CA$",
          AUD: "AU$",
          NZD: "NZ$",
          SGD: "S$",
          HKD: "HK$",
        })[code] ??
        (symbol || (code ? `${code} ` : "$"));

  return `${prefix}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)}`;
}

function meetsKickstarterMinPledgedUsd(amount: number | null) {
  return amount === null || amount >= KICKSTARTER_MIN_PLEDGED_USD;
}

function formatKickstarterDaysLeftLabel(deadlineAt: Date | null, now: Date) {
  if (!deadlineAt) {
    return null;
  }

  const deltaMs = deadlineAt.getTime() - now.getTime();

  if (deltaMs <= 0) {
    return null;
  }

  const hoursLeft = Math.ceil(deltaMs / (1000 * 60 * 60));

  if (hoursLeft < 48) {
    return `${hoursLeft} hours`;
  }

  return `${Math.max(1, Math.floor(deltaMs / (1000 * 60 * 60 * 24)))} days`;
}

function getKickstarterStateStatusLabel(state: string, daysLeftLabel: string | null) {
  switch (compactText(state).toLowerCase()) {
    case "live":
      return "Live";
    case "submitted":
    case "starting":
    case "draft":
      return "Upcoming";
    case "successful":
    case "failed":
    case "canceled":
    case "cancelled":
    case "suspended":
      return "Ended";
    default:
      return getStatusLabel(state, daysLeftLabel);
  }
}

function extractKickstarterStructuredString(html: string, key: string) {
  const patterns = [
    new RegExp(`${escapeRegExp(key)}\\\\":\\\\"([^"\\\\]+)`, "i"),
    new RegExp(`${escapeRegExp(key)}":"([^"]+)`, "i"),
  ];

  for (const pattern of patterns) {
    const matched = html.match(pattern)?.[1];

    if (!matched) {
      continue;
    }

    return compactText(
      matched
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/\\u0026/g, "&")
        .replace(/\\u003c/g, "<")
        .replace(/\\u003e/g, ">"),
    );
  }

  return "";
}

function extractKickstarterStructuredNumber(html: string, key: string) {
  const patterns = [
    new RegExp(`${escapeRegExp(key)}\\\\":([0-9.]+)`, "i"),
    new RegExp(`${escapeRegExp(key)}":([0-9.]+)`, "i"),
  ];

  for (const pattern of patterns) {
    const matched = html.match(pattern)?.[1];

    if (!matched) {
      continue;
    }

    const parsed = Number(matched);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractKickstarterStructuredDate(html: string, key: string) {
  const value = extractKickstarterStructuredString(html, key);

  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function extractKickstarterDiscoverProjectUrls(html: string) {
  return extractKickstarterDiscoverProjectEntries(html).map((entry) => entry.campaignUrl);
}

function extractKickstarterDiscoverProjectEntries(html: string) {
  const $ = load(html);
  const entries: KickstarterDiscoverProjectEntry[] = [];
  const seenUrls = new Set<string>();

  $('a[href*="ref=discovery_category_newest"]').each((_, element) => {
    const href = $(element).attr("href");
    const normalized = normalizeKickstarterCampaignUrl(href ? new URL(href, "https://www.kickstarter.com").toString() : "");

    if (!normalized || seenUrls.has(normalized)) {
      return;
    }

    seenUrls.add(normalized);
    entries.push({
      campaignName: compactText($(element).text()) || decodeSlugFromUrl(normalized),
      campaignUrl: normalized,
    });
  });

  return entries;
}

function extractKickstarterDiscoverProjectJson(decodedHtml: string, slug: string) {
  const marker = `"slug":"${slug}"`;
  const slugIndex = decodedHtml.indexOf(marker);

  if (slugIndex < 0) {
    return "";
  }

  const startIndex = decodedHtml.lastIndexOf('{"id":', slugIndex);

  if (startIndex < 0) {
    return "";
  }

  let depth = 0;

  for (let index = startIndex; index < decodedHtml.length; index += 1) {
    const character = decodedHtml[index];

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character !== "}") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return decodedHtml.slice(startIndex, index + 1);
    }
  }

  return "";
}

function parseKickstarterDiscoverProjectRecord(value: string, campaignUrl: string): KickstarterDiscoverProjectRecord | null {
  if (!value) {
    return null;
  }

  try {
    const record = JSON.parse(value) as {
      name?: string;
      blurb?: string;
      goal?: number;
      pledged?: number;
      state?: string;
      slug?: string;
      currency?: string;
      currency_symbol?: string;
      deadline?: number;
      launched_at?: number;
      backers_count?: number;
      creator?: { name?: string; urls?: { web?: { user?: string } } };
      photo?: Record<string, string>;
    };

    const imageUrl =
      normalizeImageUrl(record.photo?.["1024x576"], campaignUrl) ||
      normalizeImageUrl(record.photo?.["1536x864"], campaignUrl) ||
      normalizeImageUrl(record.photo?.full, campaignUrl) ||
      normalizeImageUrl(record.photo?.med, campaignUrl) ||
      normalizeImageUrl(record.photo?.small, campaignUrl);

    return {
      name: compactText(record.name),
      blurb: clampPlainText(compactText(record.blurb), 280),
      goalAmount: typeof record.goal === "number" ? Math.round(record.goal) : null,
      pledgedAmount: typeof record.pledged === "number" ? Math.round(record.pledged) : null,
      state: compactText(record.state),
      slug: compactText(record.slug),
      currency: compactText(record.currency) || null,
      currencySymbol: compactText(record.currency_symbol) || null,
      deadlineAt: typeof record.deadline === "number" ? new Date(record.deadline * 1000) : null,
      startedAt: typeof record.launched_at === "number" ? new Date(record.launched_at * 1000) : null,
      backersCount: typeof record.backers_count === "number" ? Math.round(record.backers_count) : null,
      creatorName: compactText(record.creator?.name) || null,
      creatorUrl: normalizeUrl(record.creator?.urls?.web?.user) || null,
      imageUrl,
    };
  } catch {
    return null;
  }
}

function createKickstarterCampaignFromDiscoverRecord(
  record: KickstarterDiscoverProjectRecord,
  campaignUrl: string,
  now: Date,
): KickstarterCampaign | null {
  if (!meetsKickstarterMinPledgedUsd(record.pledgedAmount)) {
    return null;
  }

  const campaignName = compactText(record.name);

  if (!campaignName) {
    return null;
  }

  const daysLeftLabel = formatKickstarterDaysLeftLabel(record.deadlineAt, now);
  const statusLabel = getKickstarterStateStatusLabel(record.state, daysLeftLabel);
  const classificationHaystack = compactText(`${campaignName} ${record.blurb} ${record.creatorName ?? ""} ${campaignUrl}`);

  return {
    campaignName,
    campaignUrl,
    imageUrl: record.imageUrl,
    creatorName: record.creatorName ?? "",
    creatorUrl: record.creatorUrl,
    startedAt: record.startedAt,
    startedLabel: formatKickstarterStartedLabel(record.startedAt),
    summaryRaw: record.blurb,
    pledgedAmount: record.pledgedAmount,
    pledgedLabel: formatKickstarterCurrencyLabel(record.pledgedAmount, record.currency, record.currencySymbol),
    goalAmount: record.goalAmount,
    goalLabel: formatKickstarterCurrencyLabel(record.goalAmount, record.currency, record.currencySymbol),
    backersCount: record.backersCount,
    backersLabel: record.backersCount === null ? "" : new Intl.NumberFormat("en-US").format(record.backersCount),
    statusLabel,
    daysLeftLabel,
    isLive: statusLabel === "Live",
    collectedAt: now,
    searchRelevance: Math.max(getSearchRelevance(classificationHaystack), 100),
  };
}

export function extractKickstarterDiscoverCampaignsFromHtml(html: string, now: Date) {
  const decodedHtml = decodeKickstarterHtmlEntities(html);
  const urls = extractKickstarterDiscoverProjectUrls(html);
  const campaigns: KickstarterCampaign[] = [];

  for (const campaignUrl of urls) {
    const slug = new URL(campaignUrl).pathname.split("/").filter(Boolean)[2] ?? "";
    const projectJson = extractKickstarterDiscoverProjectJson(decodedHtml, slug);
    const record = parseKickstarterDiscoverProjectRecord(projectJson, campaignUrl);
    const campaign = record ? createKickstarterCampaignFromDiscoverRecord(record, campaignUrl, now) : null;

    if (campaign) {
      campaigns.push(campaign);
    }
  }

  return campaigns;
}

export function extractKickstarterStructuredMetadata(html: string, campaignUrl: string): KickstarterStructuredMetadata {
  const creatorName = extractKickstarterStructuredString(html, "project_creator_name") || null;
  const imageUrl =
    normalizeImageUrl(extractKickstarterStructuredString(html, "project_photo_full"), campaignUrl) ||
    extractPreviewImageUrlFromContent(html, campaignUrl);
  const pledgedAmount = extractKickstarterStructuredNumber(html, "project_current_amount_pledged_usd");
  const goalAmount = extractKickstarterStructuredNumber(html, "project_goal_usd");
  const backersCount = extractKickstarterStructuredNumber(html, "project_backers_count");
  const startedAt = extractKickstarterStructuredDate(html, "project_launched_at");
  const summaryRaw = clampPlainText(extractKickstarterStructuredString(html, "project_blurb"), 280);

  return {
    creatorName,
    imageUrl,
    pledgedAmount,
    pledgedLabel: formatUsdLabel(pledgedAmount),
    goalAmount,
    goalLabel: formatUsdLabel(goalAmount),
    backersCount,
    backersLabel: backersCount === null ? "" : new Intl.NumberFormat("en-US").format(backersCount),
    startedAt,
    startedLabel: formatKickstarterStartedLabel(startedAt),
    summaryRaw,
  };
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

export function createKickstarterCampaignFromProjectPage(input: {
  pageHtml: string;
  pageText: string;
  pageTitle: string;
  pageUrl: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const baseCandidate = parseKickstarterCampaignCandidate(
    {
      title: input.pageTitle,
      url: input.pageUrl,
      content: input.pageText,
      score: 1,
    },
    now,
    { trustTechnologySource: true },
  );

  if (!baseCandidate) {
    return null;
  }

  const structured = extractKickstarterStructuredMetadata(input.pageHtml, baseCandidate.campaignUrl);
  const classificationHaystack = compactText(
    `${input.pageTitle} ${input.pageText} ${structured.summaryRaw} ${structured.creatorName ?? ""} ${baseCandidate.campaignUrl}`,
  );
  const campaign = {
    ...baseCandidate,
    imageUrl: baseCandidate.imageUrl ?? structured.imageUrl,
    creatorName: structured.creatorName ?? baseCandidate.creatorName,
    startedAt: structured.startedAt ?? baseCandidate.startedAt,
    startedLabel: structured.startedLabel ?? baseCandidate.startedLabel,
    summaryRaw: baseCandidate.summaryRaw || structured.summaryRaw,
    pledgedAmount: baseCandidate.pledgedAmount ?? structured.pledgedAmount,
    pledgedLabel: baseCandidate.pledgedLabel || structured.pledgedLabel,
    goalAmount: baseCandidate.goalAmount ?? structured.goalAmount,
    goalLabel: baseCandidate.goalLabel || structured.goalLabel,
    backersCount: baseCandidate.backersCount ?? structured.backersCount,
    backersLabel: baseCandidate.backersLabel || structured.backersLabel,
    searchRelevance: Math.max(baseCandidate.searchRelevance, getSearchRelevance(classificationHaystack)),
  } satisfies KickstarterCampaign;

  return meetsKickstarterMinPledgedUsd(campaign.pledgedAmount) ? campaign : null;
}

async function withKickstarterBrowserContext<T>(
  callback: (context: import("playwright").BrowserContext) => Promise<T>,
): Promise<T> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    const context = await browser.newContext({
      locale: "en-US",
      timezoneId: "America/New_York",
      userAgent: KICKSTARTER_BROWSER_USER_AGENT,
      viewport: { width: 1440, height: 900 },
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      // `window.chrome` is commonly checked by bot defenses.
      (window as typeof window & { chrome?: { runtime: Record<string, never> } }).chrome = { runtime: {} };
    });

    try {
      return await callback(context);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function fetchKickstarterProjectPageCandidate(
  context: import("playwright").BrowserContext,
  campaignUrl: string,
  now: Date,
) {
  const page = await context.newPage();

  try {
    page.setDefaultNavigationTimeout(DISCOVER_REQUEST_TIMEOUT_MS);
    const response = await page.goto(campaignUrl, {
      waitUntil: "domcontentloaded",
      timeout: DISCOVER_REQUEST_TIMEOUT_MS,
    });

    if (!response?.ok()) {
      return null;
    }

    await page.waitForTimeout(DISCOVER_SETTLE_DELAY_MS);
    const pageTitle = compactText(await page.title());

    if (/just a moment/i.test(pageTitle) || /^discover\b/i.test(pageTitle)) {
      return null;
    }

    const [pageHtml, pageText] = await Promise.all([page.content(), page.locator("body").innerText()]);
    return createKickstarterCampaignFromProjectPage({
      pageHtml,
      pageText,
      pageTitle,
      pageUrl: campaignUrl,
      now,
    });
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

function buildKickstarterDiscoverNewestUrl(pageNumber: number) {
  if (pageNumber <= 1) {
    return KICKSTARTER_DISCOVER_NEWEST_URL;
  }

  return `${KICKSTARTER_DISCOVER_NEWEST_URL}&page=${pageNumber}`;
}

function coalesceParsedKickstarterSearchResults(results: TavilySearchResult[], now: Date) {
  const candidates = results
    .map((result) => parseKickstarterCampaignCandidate(result, now, { trustTechnologySource: true }))
    .filter((candidate): candidate is KickstarterCampaign => Boolean(candidate));

  return coalesceKickstarterCampaigns(candidates, 1)[0] ?? null;
}

async function fetchKickstarterCampaignFromDiscoverEntry(
  entry: KickstarterDiscoverProjectEntry,
  now: Date,
): Promise<KickstarterCampaign | null> {
  const exactUrlResults = await searchWithTavily(`"${entry.campaignUrl}"`, { maxResults: 8 });
  const exactUrlMatches = exactUrlResults.filter(
    (result) => normalizeKickstarterCampaignUrl(result.url) === entry.campaignUrl,
  );
  const exactUrlCandidate = coalesceParsedKickstarterSearchResults(
    exactUrlMatches.length > 0 ? exactUrlMatches : exactUrlResults,
    now,
  );

  if (exactUrlCandidate) {
    return exactUrlCandidate;
  }

  if (!entry.campaignName) {
    return null;
  }

  const titleResults = await searchWithTavily(`"${entry.campaignName}" site:kickstarter.com/projects`, { maxResults: 8 });
  const titleMatches = titleResults.filter((result) => normalizeKickstarterCampaignUrl(result.url) === entry.campaignUrl);
  return coalesceParsedKickstarterSearchResults(titleMatches.length > 0 ? titleMatches : titleResults, now);
}

async function fetchKickstarterDiscoverCampaigns(limit: number, now: Date) {
  return withKickstarterBrowserContext(async (context) => {
    const page = await context.newPage();

    try {
      page.setDefaultNavigationTimeout(DISCOVER_REQUEST_TIMEOUT_MS);
      const campaigns: KickstarterCampaign[] = [];
      const discoverEntries: KickstarterDiscoverProjectEntry[] = [];
      const seenDiscoverUrls = new Set<string>();
      const discoverTargetLimit = Math.max(limit, KICKSTARTER_DISCOVER_URL_LIMIT);

      for (let pageNumber = 1; pageNumber <= KICKSTARTER_DISCOVER_PAGE_LIMIT; pageNumber += 1) {
        const response = await page.goto(buildKickstarterDiscoverNewestUrl(pageNumber), {
          waitUntil: "domcontentloaded",
          timeout: DISCOVER_REQUEST_TIMEOUT_MS,
        });

        if (!response?.ok()) {
          break;
        }

        await page.waitForTimeout(DISCOVER_SETTLE_DELAY_MS);

        if (/just a moment/i.test(await page.title())) {
          break;
        }

        const discoverHtml = await page.content();
        const pageCampaigns = extractKickstarterDiscoverCampaignsFromHtml(discoverHtml, now);

        if (pageCampaigns.length > 0) {
          campaigns.push(...pageCampaigns);
        }

        for (const entry of extractKickstarterDiscoverProjectEntries(discoverHtml)) {
          if (seenDiscoverUrls.has(entry.campaignUrl)) {
            continue;
          }

          seenDiscoverUrls.add(entry.campaignUrl);
          discoverEntries.push(entry);
        }

        if (discoverEntries.length >= discoverTargetLimit && pageNumber > 1) {
          break;
        }
      }

      if (coalesceKickstarterCampaigns(campaigns, discoverTargetLimit).length >= limit) {
        return coalesceKickstarterCampaigns(campaigns, discoverTargetLimit);
      }

      const seenUrls = new Set(campaigns.map((campaign) => campaign.campaignUrl));

      for (const entry of discoverEntries.slice(0, discoverTargetLimit)) {
        if (seenUrls.has(entry.campaignUrl)) {
          continue;
        }

        let campaign = await fetchKickstarterCampaignFromDiscoverEntry(entry, now);

        if (!campaign) {
          campaign = await fetchKickstarterProjectPageCandidate(context, entry.campaignUrl, now);
        }

        if (campaign) {
          campaigns.push(campaign);
          seenUrls.add(campaign.campaignUrl);
        }
      }

      return coalesceKickstarterCampaigns(campaigns, discoverTargetLimit);
    } finally {
      await page.close();
    }
  });
}

function extractKickstarterCampaignSupplementFromResults(
  results: TavilySearchResult[],
  campaignUrl: string,
): KickstarterCampaignSupplement | null {
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

async function fetchKickstarterCampaignSupplement(
  campaignUrl: string,
  campaignName: string,
): Promise<KickstarterCampaignSupplement | null> {
  const exactUrlResults = await searchWithTavily(`"${campaignUrl}"`, { maxResults: 8 });
  const exactUrlSupplement = extractKickstarterCampaignSupplementFromResults(exactUrlResults, campaignUrl);

  if (exactUrlSupplement?.startedAt && exactUrlSupplement.imageUrl) {
    return exactUrlSupplement;
  }

  if (!campaignName) {
    return exactUrlSupplement;
  }

  const titleResults = await searchWithTavily(`"${campaignName}" site:kickstarter.com/projects`, { maxResults: 8 });
  const titleSupplement = extractKickstarterCampaignSupplementFromResults(titleResults, campaignUrl);

  if (!titleSupplement) {
    return exactUrlSupplement;
  }

  return {
    startedAt: exactUrlSupplement?.startedAt ?? titleSupplement.startedAt,
    startedLabel: exactUrlSupplement?.startedLabel ?? titleSupplement.startedLabel,
    imageUrl: exactUrlSupplement?.imageUrl ?? titleSupplement.imageUrl,
  };
}

async function enrichKickstarterCampaign(campaign: KickstarterCampaign) {
  let nextCampaign = campaign;

  if (!campaign.startedAt || !campaign.imageUrl) {
    const supplement = await fetchKickstarterCampaignSupplement(campaign.campaignUrl, campaign.campaignName);

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
  options?: KickstarterCandidateParseOptions,
): KickstarterCampaign | null {
  const campaignUrl = normalizeKickstarterCampaignUrl(result.url);

  if (!campaignUrl) {
    return null;
  }

  const metricsText = compactText(result.content || result.title);
  const narrativeText = extractKickstarterNarrative(result.content || result.title);
  const classificationHaystack = compactText(`${result.title} ${narrativeText} ${campaignUrl}`);

  if (!options?.trustTechnologySource && !isTargetKickstarterProject(classificationHaystack)) {
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

  if (
    !hasFundingSignal &&
    !options?.trustTechnologySource &&
    !isTargetKickstarterProject(classificationHaystack, { requireStrongSignal: true })
  ) {
    return null;
  }

  if (!meetsKickstarterMinPledgedUsd(pledged.amount)) {
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
    searchRelevance: Math.max(
      getSearchRelevance(classificationHaystack),
      Math.round(result.score * 100),
      options?.trustTechnologySource ? 100 : 0,
    ),
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
    if (!meetsKickstarterMinPledgedUsd(candidate.pledgedAmount)) {
      continue;
    }

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

async function searchWithTavily(query: string, options?: { timeRange?: "week" | "month" | "year"; maxResults?: number }) {
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
        content: mergeTavilySearchContent(result.content, result.raw_content),
        score: typeof result.score === "number" ? result.score : 0,
      }))
      .filter((result: TavilySearchResult) => result.url && (result.title || result.content));
  } catch {
    return [];
  }
}

export async function fetchKickstarterCampaigns(limit = 10) {
  const now = new Date();
  const preEnrichLimit = Math.max(limit, KICKSTARTER_PRE_ENRICH_POOL_LIMIT);
  const candidates: KickstarterCampaign[] = await fetchKickstarterDiscoverCampaigns(limit, now).catch((error) => {
    const reason = error instanceof Error ? error.message : "unknown browser fetch error";
    console.warn("Kickstarter discover fetch failed:", reason);
    return [];
  });

  for (const plan of SEARCH_PLANS) {
    for (const window of plan.windows) {
      const results = await searchWithTavily(plan.query, {
        timeRange: window.timeRange,
        maxResults: window.maxResults,
      });

      for (const result of results) {
        const candidate = parseKickstarterCampaignCandidate(result, now);

        if (candidate) {
          candidates.push(candidate);
        }
      }
    }
  }

  const shortlisted = coalesceKickstarterCampaigns(candidates, preEnrichLimit);
  const enriched = await Promise.all(shortlisted.map((campaign) => enrichKickstarterCampaign(campaign)));
  return coalesceKickstarterCampaigns(enriched, limit);
}
