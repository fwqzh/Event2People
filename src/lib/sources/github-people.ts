import * as cheerio from "cheerio";

import { env } from "@/lib/env";
import { getTavilyApiKey } from "@/lib/runtime-settings";
import { compactInstitution, repoDisplayName, uniqueStrings } from "@/lib/text";
import type { PersonInput, ProjectInput } from "@/lib/types";

type GitHubOwnerProfile = {
  login: string;
  name: string;
  htmlUrl: string;
  bio: string;
  company: string;
  blog: string;
  email: string;
  twitterUsername: string;
};

type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
};

type HomepageSignals = {
  homepageUrl: string;
  snippets: string[];
  email: string;
  githubUrl: string;
  scholarUrl: string;
  linkedinUrl: string;
  xUrl: string;
};

type GitHubOwnerContext = {
  login: string;
  ownerUrl: string;
  type?: string;
  repoRoles: Array<{
    repoName: string;
    repoDescription: string;
    isOwner: boolean;
    contributions: number;
  }>;
};

type GitHubOwnerProgress = {
  completed: number;
  total: number;
  login: string;
};

const GITHUB_HEADERS: HeadersInit = {
  "User-Agent": "Event2People/1.0",
  Accept: "application/vnd.github+json",
  ...(env.githubToken ? { Authorization: `Bearer ${env.githubToken}` } : {}),
};

const SEARCH_REQUEST_TIMEOUT_MS = 20_000;
const HOMEPAGE_REQUEST_TIMEOUT_MS = 12_000;
const SOCIAL_HOST_PATTERNS = [
  /(^|\.)github\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)scholar\.google\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
];

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function titleCaseGithubLogin(login: string) {
  return login
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeUrlCandidate(value: string | null | undefined) {
  const text = compactText(value);

  if (!text) {
    return "";
  }

  if (/^https?:\/\//i.test(text)) {
    return text;
  }

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(text)) {
    return `https://${text}`;
  }

  return "";
}

function normalizeEmail(value: string | null | undefined) {
  const email = compactText(value).replace(/^mailto:/i, "");
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email) ? email : "";
}

function normalizeProfileUrl(value: string | null | undefined) {
  const url = normalizeUrlCandidate(value);

  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (parsed.searchParams.has("trk")) {
      parsed.searchParams.delete("trk");
    }
    return parsed.toString().replace(/\/+$/g, "");
  } catch {
    return "";
  }
}

function tokenizeName(value: string) {
  return compactText(value)
    .toLowerCase()
    .split(/[\s-]+/g)
    .filter((token) => token.length >= 2);
}

export function githubStableId(login: string) {
  return `github:${login.toLowerCase()}`;
}

function buildEvidenceSummary(repoRoles: GitHubOwnerContext["repoRoles"]) {
  const sortedRoles = [...repoRoles].sort((left, right) => {
    if (left.isOwner !== right.isOwner) {
      return left.isOwner ? -1 : 1;
    }

    return right.contributions - left.contributions;
  });

  const clauses = sortedRoles.slice(0, 2).map((role) => {
    const repoName = repoDisplayName(role.repoName);

    if (role.isOwner) {
      return `创建 ${repoName}`;
    }

    return role.contributions > 0 ? `参与 ${repoName} 核心开发（${role.contributions} commits）` : `参与 ${repoName} 核心开发`;
  });

  return uniqueStrings(clauses).join("；") || "参与相关 repo";
}

function buildOwnerBasePerson(context: GitHubOwnerContext) {
  const displayName = titleCaseGithubLogin(context.login);
  const hasOwnerRole = context.repoRoles.some((role) => role.isOwner);
  const ownerType = compactText(context.type);

  return {
    stableId: githubStableId(context.login),
    name: displayName,
    identitySummaryZh: hasOwnerRole ? (ownerType === "Organization" ? "开源项目 · GitHub 维护者" : "GitHub 构建者") : "GitHub 核心贡献者",
    evidenceSummaryZh: buildEvidenceSummary(context.repoRoles),
    sourceUrls: [context.ownerUrl],
    githubUrl: context.ownerUrl,
    organizationNamesRaw: [],
    bioSnippetsRaw: [],
    founderHistoryRaw: [],
  } satisfies PersonInput;
}

async function fetchGitHubOwnerProfile(login: string) {
  const response = await fetch(`https://api.github.com/users/${login}`, {
    headers: GITHUB_HEADERS,
    next: { revalidate: 60 * 60 },
    signal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GitHub user fetch failed: ${response.status}`);
  }

  const payload = await response.json();

  return {
    login: payload.login ?? login,
    name: compactText(payload.name),
    htmlUrl: payload.html_url ?? `https://github.com/${login}`,
    bio: compactText(payload.bio),
    company: compactInstitution(payload.company),
    blog: compactText(payload.blog),
    email: normalizeEmail(payload.email),
    twitterUsername: compactText(payload.twitter_username),
  } satisfies GitHubOwnerProfile;
}

async function fetchGitHubOwnerOrgs(login: string) {
  const response = await fetch(`https://api.github.com/users/${login}/orgs?per_page=5`, {
    headers: GITHUB_HEADERS,
    next: { revalidate: 60 * 60 },
    signal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((org) => compactInstitution(org?.login ?? ""))
    .filter(Boolean)
    .slice(0, 5);
}

function extractEmailsFromText(value: string) {
  return uniqueStrings(value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((email) => normalizeEmail(email)).filter(Boolean);
}

function classifyHomepageLink(url: string) {
  if (/linkedin\.com/i.test(url)) {
    return "linkedin";
  }

  if (/scholar\.google\.com/i.test(url)) {
    return "scholar";
  }

  if (/(^https?:\/\/)?(x|twitter)\.com\//i.test(url)) {
    return "x";
  }

  if (/github\.com/i.test(url)) {
    return "github";
  }

  return "other";
}

function absolutizeUrl(href: string, baseUrl: string) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function extractCandidateSubpages($: cheerio.CheerioAPI, baseUrl: string) {
  return $("a[href]")
    .map((_, element) => {
      const href = $(element).attr("href") ?? "";
      const text = compactText($(element).text());
      const absolute = absolutizeUrl(href, baseUrl);

      if (!absolute) {
        return "";
      }

      if (!/(contact|about|bio|team)/i.test(`${href} ${text}`)) {
        return "";
      }

      try {
        const candidateUrl = new URL(absolute);
        const originUrl = new URL(baseUrl);
        return candidateUrl.origin === originUrl.origin ? candidateUrl.toString() : "";
      } catch {
        return "";
      }
    })
    .get()
    .filter(Boolean)
    .slice(0, 2);
}

export function parseHomepageSignals(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  const title = compactText($("title").text());
  const metaDescription = compactText(
    $('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "",
  );
  const bodyText = compactText($("body").text()).slice(0, 1200);

  let email = "";
  let githubUrl = "";
  let scholarUrl = "";
  let linkedinUrl = "";
  let xUrl = "";

  $("a[href]").each((_, element) => {
    const href = absolutizeUrl($(element).attr("href") ?? "", pageUrl);

    if (!href) {
      return;
    }

    const linkType = classifyHomepageLink(href);

    if (!email) {
      const mailto = normalizeEmail($(element).attr("href"));
      if (mailto) {
        email = mailto;
      }
    }

    if (linkType === "github" && !githubUrl) {
      githubUrl = normalizeProfileUrl(href);
    }

    if (linkType === "scholar" && !scholarUrl) {
      scholarUrl = normalizeProfileUrl(href);
    }

    if (linkType === "linkedin" && !linkedinUrl) {
      linkedinUrl = normalizeProfileUrl(href);
    }

    if (linkType === "x" && !xUrl) {
      xUrl = normalizeProfileUrl(href);
    }
  });

  if (!email) {
    email = extractEmailsFromText(`${title} ${metaDescription} ${bodyText}`)[0] ?? "";
  }

  return {
    homepageUrl: normalizeProfileUrl(pageUrl),
    snippets: uniqueStrings([title, metaDescription]).slice(0, 3),
    email,
    githubUrl,
    scholarUrl,
    linkedinUrl,
    xUrl,
    candidateSubpages: extractCandidateSubpages($, pageUrl),
  };
}

async function fetchHomepageSignals(rawUrl: string) {
  const homepageUrl = normalizeUrlCandidate(rawUrl);

  if (!homepageUrl) {
    return null;
  }

  try {
    const response = await fetch(homepageUrl, {
      headers: { "User-Agent": "Event2People/1.0", Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(HOMEPAGE_REQUEST_TIMEOUT_MS),
      next: { revalidate: 60 * 60 },
    });

    if (!response.ok) {
      return null;
    }

    const finalUrl = response.url || homepageUrl;
    const html = await response.text();
    const parsed = parseHomepageSignals(html, finalUrl);
    const snippets = [...parsed.snippets];
    let email = parsed.email;
    let githubUrl = parsed.githubUrl;
    let scholarUrl = parsed.scholarUrl;
    let linkedinUrl = parsed.linkedinUrl;
    let xUrl = parsed.xUrl;

    for (const candidateSubpage of parsed.candidateSubpages) {
      if (email && scholarUrl && linkedinUrl && xUrl) {
        break;
      }

      try {
        const subpageResponse = await fetch(candidateSubpage, {
          headers: { "User-Agent": "Event2People/1.0", Accept: "text/html,application/xhtml+xml" },
          redirect: "follow",
          signal: AbortSignal.timeout(HOMEPAGE_REQUEST_TIMEOUT_MS),
          next: { revalidate: 60 * 60 },
        });

        if (!subpageResponse.ok) {
          continue;
        }

        const subpageParsed = parseHomepageSignals(await subpageResponse.text(), subpageResponse.url || candidateSubpage);
        snippets.push(...subpageParsed.snippets);
        email ||= subpageParsed.email;
        githubUrl ||= subpageParsed.githubUrl;
        scholarUrl ||= subpageParsed.scholarUrl;
        linkedinUrl ||= subpageParsed.linkedinUrl;
        xUrl ||= subpageParsed.xUrl;
      } catch {
        continue;
      }
    }

    return {
      homepageUrl: parsed.homepageUrl,
      snippets: uniqueStrings(snippets).slice(0, 4),
      email,
      githubUrl,
      scholarUrl,
      linkedinUrl,
      xUrl,
    } satisfies HomepageSignals;
  } catch {
    return null;
  }
}

async function searchWithTavily(query: string) {
  const tavilyApiKey = await getTavilyApiKey();

  if (!tavilyApiKey) {
    return [];
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Event2People/1.0",
      },
      body: JSON.stringify({
        api_key: tavilyApiKey,
        query,
        search_depth: "basic",
        max_results: 6,
        include_raw_content: false,
        include_answer: false,
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

    return payload.results.map((result: { title?: string; url?: string; content?: string }) => ({
      title: compactText(result.title),
      url: normalizeProfileUrl(result.url),
      content: compactText(result.content),
    }));
  } catch {
    return [];
  }
}

function matchesContext(result: TavilySearchResult, context: GitHubOwnerContext, displayName: string, company: string) {
  const haystack = `${result.title} ${result.content} ${result.url}`.toLowerCase();
  const nameTokens = tokenizeName(displayName);
  const repoTokens =
    Array.isArray(context.repoRoles) && context.repoRoles.length > 0
      ? context.repoRoles.map((role) => repoDisplayName(role.repoName).toLowerCase())
      : [];
  let score = 0;

  if (haystack.includes(context.login.toLowerCase())) {
    score += 3;
  }

  if (nameTokens.length > 0 && nameTokens.every((token) => haystack.includes(token))) {
    score += 3;
  } else if (nameTokens.some((token) => haystack.includes(token))) {
    score += 1;
  }

  if (company && haystack.includes(company.toLowerCase())) {
    score += 2;
  }

  if (repoTokens.some((token) => token && haystack.includes(token))) {
    score += 1;
  }

  return score;
}

export function pickBestSearchResult(
  results: TavilySearchResult[],
  context: GitHubOwnerContext,
  displayName: string,
  company: string,
  type: "linkedin" | "scholar" | "x" | "homepage",
) {
  const sorted = results
    .map((result) => {
      const url = normalizeProfileUrl(result.url);
      if (!url) {
        return null;
      }

      const isLinkedIn = /linkedin\.com\/in\//i.test(url);
      const isScholar = /scholar\.google\.com\/citations/i.test(url);
      const isX = /(?:^https?:\/\/)?(?:x|twitter)\.com\//i.test(url);
      const isSocial = SOCIAL_HOST_PATTERNS.some((pattern) => {
        try {
          return pattern.test(new URL(url).hostname);
        } catch {
          return false;
        }
      });

      if (type === "linkedin" && !isLinkedIn) {
        return null;
      }

      if (type === "scholar" && !isScholar) {
        return null;
      }

      if (type === "x" && !isX) {
        return null;
      }

      if (type === "homepage" && isSocial) {
        return null;
      }

      const score = matchesContext(result, context, displayName, company);
      return score > 0 ? { url, score } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right!.score - left!.score) as Array<{ url: string; score: number }>;

  const threshold = type === "homepage" ? 4 : 3;
  return sorted[0] && sorted[0].score >= threshold ? sorted[0].url : "";
}

async function enrichLinksWithSearch(context: GitHubOwnerContext, displayName: string, company: string) {
  const tavilyApiKey = await getTavilyApiKey();

  if (!tavilyApiKey) {
    return {
      linkedinUrl: "",
      scholarUrl: "",
      xUrl: "",
      homepageUrl: "",
      searchSnippets: [] as string[],
    };
  }

  const repoHints = context.repoRoles.map((role) => repoDisplayName(role.repoName)).slice(0, 2).join(" ");
  const generalQuery = [displayName || context.login, context.login, company, repoHints, "GitHub LinkedIn X homepage"].filter(Boolean).join(" ");
  const scholarQuery = [displayName || context.login, context.login, company, "Google Scholar"].filter(Boolean).join(" ");

  const [generalResults, scholarResults] = await Promise.all([searchWithTavily(generalQuery), searchWithTavily(scholarQuery)]);
  const allResults = [...generalResults, ...scholarResults];

  return {
    linkedinUrl: pickBestSearchResult(allResults, context, displayName, company, "linkedin"),
    scholarUrl: pickBestSearchResult(allResults, context, displayName, company, "scholar"),
    xUrl: pickBestSearchResult(allResults, context, displayName, company, "x"),
    homepageUrl: pickBestSearchResult(allResults, context, displayName, company, "homepage"),
    searchSnippets: uniqueStrings(allResults.flatMap((result) => [result.title, result.content])).slice(0, 4),
  };
}

export async function enrichGitHubOwnerPerson(context: GitHubOwnerContext) {
  const base = buildOwnerBasePerson(context);

  try {
    const [profile, orgs] = await Promise.all([fetchGitHubOwnerProfile(context.login), fetchGitHubOwnerOrgs(context.login)]);
    const displayName = profile.name || base.name;
    const directHomepage = normalizeUrlCandidate(profile.blog);
    const directXUrl = profile.twitterUsername ? `https://x.com/${profile.twitterUsername.replace(/^@/, "")}` : "";
    const directBlogType = classifyHomepageLink(directHomepage);
    const allowSearch = context.repoRoles.some((role) => role.isOwner);
    const searchLinks = allowSearch
      ? await enrichLinksWithSearch(context, displayName, profile.company)
      : {
          linkedinUrl: "",
          scholarUrl: "",
          xUrl: "",
          homepageUrl: "",
          searchSnippets: [] as string[],
        };

    const homepageUrl =
      directBlogType === "other" ? normalizeProfileUrl(directHomepage) : searchLinks.homepageUrl;
    const homepageSignals = await fetchHomepageSignals(homepageUrl || searchLinks.homepageUrl);

    const sourceUrls = uniqueStrings([
      profile.htmlUrl,
      homepageSignals?.homepageUrl,
      homepageSignals?.githubUrl,
      searchLinks.homepageUrl,
      searchLinks.linkedinUrl,
      searchLinks.scholarUrl,
      searchLinks.xUrl,
    ]);
    const bioSnippetsRaw = uniqueStrings([
      profile.bio,
      ...context.repoRoles.map((role) => role.repoDescription),
      ...(homepageSignals?.snippets ?? []),
      ...searchLinks.searchSnippets,
    ]).slice(0, 6);
    const founderHistoryRaw = bioSnippetsRaw.filter((snippet) => /\b(founder|co-founder|founded|创业|创始)\b/i.test(snippet)).slice(0, 3);

    return {
      stableId: base.stableId,
      name: displayName,
      identitySummaryZh: base.identitySummaryZh,
      evidenceSummaryZh: buildEvidenceSummary(context.repoRoles) || base.evidenceSummaryZh,
      sourceUrls,
      githubUrl: normalizeProfileUrl(profile.htmlUrl) || base.githubUrl,
      scholarUrl:
        normalizeProfileUrl(homepageSignals?.scholarUrl) ||
        normalizeProfileUrl(searchLinks.scholarUrl),
      linkedinUrl:
        normalizeProfileUrl(homepageSignals?.linkedinUrl) ||
        normalizeProfileUrl(searchLinks.linkedinUrl),
      xUrl:
        normalizeProfileUrl(directBlogType === "x" ? directHomepage : "") ||
        normalizeProfileUrl(directXUrl) ||
        normalizeProfileUrl(homepageSignals?.xUrl) ||
        normalizeProfileUrl(searchLinks.xUrl),
      homepageUrl:
        normalizeProfileUrl(directBlogType === "other" ? directHomepage : "") ||
        normalizeProfileUrl(homepageSignals?.homepageUrl) ||
        normalizeProfileUrl(searchLinks.homepageUrl),
      email: normalizeEmail(profile.email) || normalizeEmail(homepageSignals?.email),
      organizationNamesRaw: uniqueStrings([profile.company, ...orgs]).slice(0, 4),
      bioSnippetsRaw,
      founderHistoryRaw,
    } satisfies PersonInput;
  } catch (error) {
    console.warn(`GitHub owner enrichment fallback for ${context.login}:`, error instanceof Error ? error.message : "unknown error");
    return base;
  }
}

export async function enrichGitHubOwners(
  projects: ProjectInput[],
  onProgress?: (progress: GitHubOwnerProgress) => void | Promise<void>,
) {
  const owners = new Map<string, GitHubOwnerContext>();

  for (const project of projects) {
    const ownerLogin = project.ownerName;
    const ownerContext = owners.get(ownerLogin) ?? {
      login: ownerLogin,
      ownerUrl: project.ownerUrl,
      type: project.ownerType ?? undefined,
      repoRoles: [],
    };

    ownerContext.repoRoles.push({
      repoName: project.repoName,
      repoDescription: project.repoDescriptionRaw ?? "",
      isOwner: true,
      contributions: Math.max(project.contributorsCount, 1),
    });
    owners.set(ownerLogin, ownerContext);

    for (const contributor of project.githubContributors ?? []) {
      if (!contributor.login || contributor.login.toLowerCase() === ownerLogin.toLowerCase()) {
        continue;
      }

      const contributorContext = owners.get(contributor.login) ?? {
        login: contributor.login,
        ownerUrl: contributor.htmlUrl,
        type: contributor.type,
        repoRoles: [],
      };

      contributorContext.repoRoles.push({
        repoName: project.repoName,
        repoDescription: project.repoDescriptionRaw ?? "",
        isOwner: false,
        contributions: contributor.contributions,
      });
      owners.set(contributor.login, contributorContext);
    }
  }

  const ownerList = [...owners.values()];
  const total = ownerList.length;
  let completed = 0;

  const people = await Promise.all(
    ownerList.map(async (owner) => {
      const person = await enrichGitHubOwnerPerson(owner);
      completed += 1;
      await onProgress?.({
        completed,
        total,
        login: owner.login,
      });
      return person;
    }),
  );

  return people;
}
