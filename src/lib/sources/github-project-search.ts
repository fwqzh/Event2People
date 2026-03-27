import { getTavilyApiKey } from "@/lib/runtime-settings";
import { repoDisplayName, uniqueStrings } from "@/lib/text";
import type { ProjectInput, ReferenceItem } from "@/lib/types";

const SEARCH_REQUEST_TIMEOUT_MS = 6_000;
const EXCLUDED_SOURCE_DOMAINS = [
  "github.com",
  "github.io",
  "arxiv.org",
  "huggingface.co",
  "npmjs.com",
  "pypi.org",
  "docs.rs",
];

const SOURCE_LABELS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:^|\.)36kr\.com$/i, label: "36Kr" },
  { pattern: /(?:^|\.)infoq\.cn$/i, label: "InfoQ" },
  { pattern: /(?:^|\.)csdn\.net$/i, label: "CSDN" },
  { pattern: /(?:^|\.)zhihu\.com$/i, label: "知乎" },
  { pattern: /(?:^|\.)juejin\.cn$/i, label: "掘金" },
  { pattern: /(?:^|\.)oschina\.net$/i, label: "开源中国" },
  { pattern: /(?:^|\.)qq\.com$/i, label: "腾讯" },
  { pattern: /(?:^|\.)sohu\.com$/i, label: "搜狐" },
  { pattern: /(?:^|\.)sina\.com\.cn$/i, label: "新浪" },
];

type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
};

export type GitHubProjectChineseReference = ReferenceItem & {
  content: string;
};

export type GitHubProjectNarrativeProgress = {
  completed: number;
  total: number;
  repoName: string;
};

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
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

function containsChinese(value: string) {
  return /[\u4e00-\u9fff]/.test(value);
}

function buildPrimaryQuery(project: Pick<ProjectInput, "repoName" | "ownerName" | "repoDescriptionRaw">) {
  const displayName = repoDisplayName(project.repoName);
  return [`"${project.repoName}"`, displayName, project.ownerName, "开源 项目 是什么 做什么"]
    .filter(Boolean)
    .join(" ");
}

function buildFallbackQuery(project: Pick<ProjectInput, "repoName" | "ownerName" | "repoDescriptionRaw">) {
  const displayName = repoDisplayName(project.repoName);
  return [
    displayName || project.repoName,
    project.ownerName,
    compactText(project.repoDescriptionRaw).slice(0, 60),
    "AI 开源 项目 介绍",
  ]
    .filter(Boolean)
    .join(" ");
}

function scoreResult(result: TavilySearchResult, project: Pick<ProjectInput, "repoName" | "ownerName" | "repoDescriptionRaw">) {
  const displayName = repoDisplayName(project.repoName).toLowerCase();
  const haystack = `${result.title} ${result.content} ${result.url}`.toLowerCase();
  let score = 0;

  if (haystack.includes(project.repoName.toLowerCase())) {
    score += 6;
  }

  if (displayName && haystack.includes(displayName)) {
    score += 4;
  }

  if (haystack.includes(project.ownerName.toLowerCase())) {
    score += 2;
  }

  if (/(项目|开源|框架|平台|工具)/.test(result.title) || /(项目|开源|框架|平台|工具)/.test(result.content)) {
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

export async function fetchGitHubProjectChineseReferences(project: Pick<ProjectInput, "repoName" | "ownerName" | "repoDescriptionRaw">) {
  const primaryResults = await searchWithTavily(buildPrimaryQuery(project), true);
  const fallbackResults =
    primaryResults.length > 0 ? [] : await searchWithTavily(buildFallbackQuery(project), false);

  const rankedResults = [...primaryResults, ...fallbackResults]
    .map((result) => ({
      ...result,
      score: scoreResult(result, project),
    }))
    .filter((result) => result.score >= 4 && (containsChinese(result.title) || containsChinese(result.content)))
    .sort((left, right) => right.score - left.score);

  const uniqueResults = rankedResults.filter((result, index, items) => {
    return items.findIndex((candidate) => candidate.url === result.url) === index;
  });

  return uniqueResults.slice(0, 4).map((result) => ({
    label: getSourceLabel(result.url),
    title: result.title || getSourceLabel(result.url),
    url: result.url,
    content: result.content,
  })) satisfies GitHubProjectChineseReference[];
}

async function searchProjectNarrative(project: ProjectInput) {
  const references = await fetchGitHubProjectChineseReferences(project);

  return {
    snippets: uniqueStrings(
      references
        .slice(0, 3)
        .flatMap((reference) => [reference.title, reference.content])
        .map((item) => compactText(item))
        .filter(Boolean),
    ).slice(0, 6),
    links: references.slice(0, 3).map((reference) => ({
      label: reference.label,
      url: reference.url,
    })),
  };
}

export async function enrichGitHubProjectsWithNarrativeContext(
  projects: ProjectInput[],
  onProgress?: (progress: GitHubProjectNarrativeProgress) => void | Promise<void>,
) {
  const tavilyApiKey = await getTavilyApiKey();

  if (!tavilyApiKey || projects.length === 0) {
    return projects;
  }

  let completed = 0;
  const enrichedProjects: ProjectInput[] = [];

  for (const project of projects) {
    const narrative = await searchProjectNarrative(project);
    completed += 1;

    await onProgress?.({
      completed,
      total: projects.length,
      repoName: project.repoName,
    });

    if (narrative.snippets.length === 0 && narrative.links.length === 0) {
      enrichedProjects.push(project);
      continue;
    }

    enrichedProjects.push({
      ...project,
      marketContextSnippetsRaw: narrative.snippets,
      marketContextLinks: narrative.links,
    });
  }

  return enrichedProjects;
}
