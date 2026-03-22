import * as cheerio from "cheerio";

import { env } from "@/lib/env";

type GitHubTrendingCandidate = {
  rank: number;
  fullName: string;
  repoUrl: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  todayStars: number;
  contributorAvatarUrls: string[];
};

export type GitHubRepoRecord = {
  rank: number;
  fullName: string;
  htmlUrl: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  todayStars: number;
  contributorAvatarUrls: string[];
  contributorsCount: number;
  topics: string[];
  createdAt: Date;
  updatedAt: Date;
  owner: {
    login: string;
    htmlUrl: string;
    type: string;
  };
  readmeExcerpt: string;
};

type TrendingCache = {
  records: GitHubRepoRecord[];
  updatedAt: number;
};

const GITHUB_HEADERS: HeadersInit = {
  "User-Agent": "Event2People/1.0",
  Accept: "application/vnd.github+json",
  ...(env.githubToken ? { Authorization: `Bearer ${env.githubToken}` } : {}),
};

let trendingCache: TrendingCache | null = null;

function parseCount(text: string) {
  const normalized = text.replace(/,/g, "").replace(/\s+/g, " ").trim();
  const match = normalized.match(/(\d+(?:\.\d+)?)([kKmM]?)/);

  if (!match) {
    return 0;
  }

  const value = Number(match[1]);
  const suffix = match[2].toLowerCase();

  if (suffix === "k") {
    return Math.round(value * 1000);
  }

  if (suffix === "m") {
    return Math.round(value * 1_000_000);
  }

  return Math.round(value);
}

export function parseTrendingDailyHtml(html: string) {
  const $ = cheerio.load(html);
  const candidates: GitHubTrendingCandidate[] = [];

  $("article.Box-row").each((index, element) => {
    const anchor = $(element).find("h2 a").first();
    const href = anchor.attr("href");

    if (!href) {
      return;
    }

    const fullName = href.replace(/^\//, "").trim();
    const description = $(element).find("p").first().text().replace(/\s+/g, " ").trim();
    const language = $(element).find('[itemprop="programmingLanguage"]').first().text().replace(/\s+/g, " ").trim();

    const starsHref = `/${fullName}/stargazers`;
    const forksHref = `/${fullName}/forks`;

    const stars = parseCount($(element).find(`a[href="${starsHref}"]`).first().text());
    const forks = parseCount($(element).find(`a[href="${forksHref}"]`).first().text());
    const todayStars = parseCount($(element).find(".float-sm-right").first().text());
    const contributorAvatarUrls = $(element)
      .find('img.avatar')
      .map((_, avatar) => $(avatar).attr("src") ?? "")
      .get()
      .filter(Boolean);

    candidates.push({
      rank: index + 1,
      fullName,
      repoUrl: `https://github.com/${fullName}`,
      description,
      language,
      stars,
      forks,
      todayStars,
      contributorAvatarUrls,
    });
  });

  return candidates.sort((left, right) => right.todayStars - left.todayStars || left.rank - right.rank);
}

async function fetchTrendingDailyCandidates() {
  const response = await fetch("https://github.com/trending?since=daily", {
    headers: {
      "User-Agent": "Event2People/1.0",
      Accept: "text/html",
    },
    next: { revalidate: 60 * 15 },
  });

  if (!response.ok) {
    throw new Error(`GitHub trending fetch failed: ${response.status}`);
  }

  return parseTrendingDailyHtml(await response.text());
}

async function fetchReadme(fullName: string) {
  const response = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
    headers: {
      ...GITHUB_HEADERS,
      Accept: "application/vnd.github.raw+json",
    },
    next: { revalidate: 60 * 60 },
  });

  if (!response.ok) {
    return "";
  }

  return response.text();
}

async function enrichCandidate(candidate: GitHubTrendingCandidate) {
  const repoResponse = await fetch(`https://api.github.com/repos/${candidate.fullName}`, {
    headers: GITHUB_HEADERS,
    next: { revalidate: 60 * 60 },
  });

  if (!repoResponse.ok) {
    return null;
  }

  const repoJson = await repoResponse.json();
  const contributorsResponse = await fetch(`https://api.github.com/repos/${candidate.fullName}/contributors?per_page=5`, {
    headers: GITHUB_HEADERS,
    next: { revalidate: 60 * 60 },
  });
  const contributors = contributorsResponse.ok ? await contributorsResponse.json() : [];
  const readme = await fetchReadme(candidate.fullName);

  const record: GitHubRepoRecord = {
    rank: candidate.rank,
    fullName: repoJson.full_name ?? candidate.fullName,
    htmlUrl: repoJson.html_url ?? candidate.repoUrl,
    description: candidate.description || repoJson.description || "",
    language: candidate.language || repoJson.language || "",
    stars: candidate.stars || repoJson.stargazers_count || 0,
    forks: candidate.forks || repoJson.forks_count || 0,
    todayStars: candidate.todayStars,
    contributorAvatarUrls: candidate.contributorAvatarUrls,
    contributorsCount: Array.isArray(contributors) ? contributors.length : 0,
    topics: repoJson.topics ?? [],
    createdAt: new Date(repoJson.created_at),
    updatedAt: new Date(repoJson.updated_at),
    owner: {
      login: repoJson.owner?.login ?? candidate.fullName.split("/")[0],
      htmlUrl: repoJson.owner?.html_url ?? candidate.repoUrl,
      type: repoJson.owner?.type ?? "User",
    },
    readmeExcerpt: readme.slice(0, 4000),
  };

  return record;
}

export async function fetchGitHubTrendingRepos(limit = 10) {
  try {
    const candidates = await fetchTrendingDailyCandidates();
    const topCandidates = candidates.slice(0, Math.max(limit, 10));

    const records = (
      await Promise.all(topCandidates.map((candidate) => enrichCandidate(candidate)))
    ).filter(Boolean) as GitHubRepoRecord[];

    const sorted = records
      .sort((left, right) => right.todayStars - left.todayStars || left.rank - right.rank)
      .slice(0, limit)
      .map((record, index) => ({
        ...record,
        rank: index + 1,
      }));

    if (sorted.length > 0) {
      trendingCache = {
        records: sorted,
        updatedAt: Date.now(),
      };
      return sorted;
    }
  } catch (error) {
    console.warn("GitHub trending daily fallback:", error instanceof Error ? error.message : "unknown fetch error");
  }

  if (trendingCache) {
    return trendingCache.records.slice(0, limit);
  }

  throw new Error("GitHub trending fetch failed and no cached result is available");
}
