import { subDays, subMinutes } from "date-fns";
import { Prisma, PrismaClient } from "@prisma/client";

import { classifyEventTag } from "@/lib/event-tag";
import { buildGitHubProjectIntroZh } from "@/lib/github-copy";
import { readStringArray } from "@/lib/json";
import { shouldMergePeople } from "@/lib/merge-people";
import { enrichBundleWithOpenAI } from "@/lib/openai-enrichment";
import { buildPaperExplanationZh } from "@/lib/paper-copy";
import {
  buildRefreshRangeProgress,
  buildRefreshStageMessage,
  getRefreshStageCopy,
  toRefreshStatusSnapshot,
} from "@/lib/refresh-progress";
import { decideRepoPaperLink } from "@/lib/repo-paper-linking";
import { buildSampleDataset } from "@/lib/sample-data";
import { parseLinks, parseMetrics, persistDataset } from "@/lib/seed";
import { fetchArxivPapers } from "@/lib/sources/arxiv";
import { fetchKickstarterCampaigns, type KickstarterCampaign } from "@/lib/sources/kickstarter";
import { enrichGitHubProjectsWithNarrativeContext } from "@/lib/sources/github-project-search";
import { enrichGitHubOwners, githubStableId } from "@/lib/sources/github-people";
import { fetchGitHubTrendingRepos } from "@/lib/sources/github";
import { clampZh, formatDay, repoDisplayName, sentenceZh, slugify, uniqueStrings } from "@/lib/text";
import type { DatasetBundleInput, EventInput, PaperInput, PersonInput, ProjectInput, RepoPaperLinkInput } from "@/lib/types";

const GITHUB_REFRESH_FETCH_LIMIT = 10;
const KICKSTARTER_REFRESH_FETCH_LIMIT = 10;
const HOMEPAGE_ARXIV_LIMIT = 10;
const ARXIV_ACTIVE_POOL_LIMIT = 50;
const AI_EVENT_ENRICH_LIMIT = GITHUB_REFRESH_FETCH_LIMIT + KICKSTARTER_REFRESH_FETCH_LIMIT + HOMEPAGE_ARXIV_LIMIT;
const STALE_REFRESH_MINUTES = 15;
const countFormatter = new Intl.NumberFormat("en-US");

function metric(label: string, value: string) {
  return { label, value };
}

function link(label: string, url: string) {
  return { label, url };
}

function uniqueLinkItems(items: Array<{ label: string; url: string }>) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (!item.url || seen.has(item.url)) {
      return false;
    }

    seen.add(item.url);
    return true;
  });
}

function formatKickstarterMoney(value: number | null, fallback = "未知") {
  return value && value > 0 ? `$${countFormatter.format(value)}` : fallback;
}

function formatKickstarterCount(value: number | null, fallback = "未知") {
  return value && value >= 0 ? countFormatter.format(value) : fallback;
}

function kickstarterStableId(campaign: Pick<KickstarterCampaign, "campaignUrl" | "creatorName" | "campaignName">) {
  return `kickstarter:${slugify(campaign.creatorName || campaign.campaignUrl || campaign.campaignName)}`;
}

function buildKickstarterFocus(tag: EventInput["eventTag"], campaign: KickstarterCampaign) {
  const haystack = [campaign.campaignName, campaign.summaryRaw].join(" ").toLowerCase();

  if (tag === "Robotics" || /robot|robotics|drone|automation/.test(haystack)) {
    return "机器人与智能硬件";
  }

  if (tag === "Voice" || /voice|speech|audio|microphone/.test(haystack)) {
    return "语音交互";
  }

  if (tag === "Video" || /video|camera/.test(haystack)) {
    return "视频与影像";
  }

  if (tag === "Coding Agent" || /developer|coding|workflow|productivity/.test(haystack)) {
    return "开发者与创作者工具";
  }

  if (tag === "AI Agent" || /agent|assistant/.test(haystack)) {
    return "AI 助手";
  }

  if (tag === "Multimodal" || /multimodal|vision-language|vision/.test(haystack)) {
    return "多模态交互";
  }

  return "前沿技术";
}

function buildKickstarterHighlight(campaign: KickstarterCampaign, tag: EventInput["eventTag"]) {
  const focus = buildKickstarterFocus(tag, campaign);
  return sentenceZh(`一个面向${focus}场景的众筹项目`, 20);
}

function buildKickstarterDetailSummary(campaign: KickstarterCampaign, tag: EventInput["eventTag"]) {
  const focus = buildKickstarterFocus(tag, campaign);
  const progress =
    campaign.pledgedAmount && campaign.goalAmount
      ? `${formatKickstarterMoney(campaign.pledgedAmount)} / ${formatKickstarterMoney(campaign.goalAmount)}`
      : campaign.pledgedAmount
        ? formatKickstarterMoney(campaign.pledgedAmount)
        : "原站金额待确认";
  const status = campaign.daysLeftLabel ? `剩余 ${campaign.daysLeftLabel}` : campaign.statusLabel;

  return clampZh(`这是一个面向${focus}的 Kickstarter 项目，当前筹款 ${progress}，状态 ${status || "未知"}。`, 64);
}

function buildRefreshMessage(
  eventCount: number,
  options: { aiEnabled: boolean; aiEventCount: number; aiPersonCount: number; aiErrors: string[]; sourceWarnings: string[] },
) {
  const parts = [`刷新完成：${eventCount} 个 event`];

  if (!options.aiEnabled) {
    parts.push("未配置 OpenAI，已使用模板文案");
    if (options.sourceWarnings.length > 0) {
      parts.push(...options.sourceWarnings);
    }
    return parts.join(" · ");
  }

  if (options.aiEventCount > 0 || options.aiPersonCount > 0) {
    parts.push(
      options.aiPersonCount > 0
        ? `AI enriched ${options.aiEventCount} 条 event / ${options.aiPersonCount} 位人物`
        : `AI enriched ${options.aiEventCount} 条 event`,
    );
  } else {
    parts.push("AI 已启用，但本次未改写文案");
  }

  if (options.aiErrors.length > 0) {
    parts.push("部分 AI enrichment 已回退");
  }

  if (options.sourceWarnings.length > 0) {
    parts.push(...options.sourceWarnings);
  }

  return parts.join(" · ");
}

type StoredPaperRecord = {
  stableId: string;
  paperTitle: string;
  paperUrl: string;
  authorsJson: Prisma.JsonValue;
  authorsCount: number;
  publishedAt: Date;
  abstractRaw: string | null;
  pdfTextRaw: string | null;
  codeUrl: string | null;
  authorEmailsRaw: Prisma.JsonValue | null;
  institutionNamesRaw: Prisma.JsonValue | null;
  relatedProjectIds: Prisma.JsonValue;
};

type ArxivRefreshFallbackPrisma = Pick<PrismaClient, "datasetVersion" | "event">;
type StoredProjectRecord = {
  stableId: string;
  repoName: string;
  repoUrl: string;
  ownerName: string;
  ownerUrl: string;
  stars: number;
  starDelta7d: number;
  contributorsCount: number;
  repoCreatedAt: Date;
  repoUpdatedAt: Date;
  repoDescriptionRaw: string | null;
  readmeExcerptRaw: string | null;
  relatedPaperIdsJson: Prisma.JsonValue;
};

type KickstarterFallbackEventRecord = Prisma.EventGetPayload<{
  include: {
    personLinks: {
      orderBy: {
        position: "asc";
      };
      include: {
        person: true;
      };
    };
  };
}>;

function personFromAuthor(name: string): PersonInput {
  return {
    stableId: `author:${slugify(name)}`,
    name,
    identitySummaryZh: clampZh("AI 研究者 · arXiv 作者", 36),
    evidenceSummaryZh: clampZh("是当前论文作者", 24),
    sourceUrls: [],
    organizationNamesRaw: [],
  };
}

function personFromKickstarterCreator(campaign: KickstarterCampaign): PersonInput | null {
  const name = campaign.creatorName.trim();

  if (!name) {
    return null;
  }

  const creatorUrl = campaign.creatorUrl?.trim() ?? "";

  return {
    stableId: kickstarterStableId(campaign),
    name,
    identitySummaryZh: clampZh("Kickstarter Creator · 众筹发起人", 36),
    evidenceSummaryZh: clampZh(`发起 Kickstarter 项目《${campaign.campaignName}》`, 36),
    sourceUrls: [creatorUrl || campaign.campaignUrl].filter(Boolean),
    homepageUrl: creatorUrl || null,
    organizationNamesRaw: [],
  };
}

function mergePeopleConservatively(people: PersonInput[]) {
  const merged: PersonInput[] = [];
  const stableIdMap = new Map<string, string>();

  for (const person of people) {
    const existing = merged.find((candidate) => shouldMergePeople(candidate, person).shouldMerge);

    if (!existing) {
      merged.push(person);
      stableIdMap.set(person.stableId, person.stableId);
      continue;
    }

    stableIdMap.set(person.stableId, existing.stableId);
  }

  return {
    people: merged,
    stableIdMap,
  };
}

function remapPersonStableIds(personStableIds: string[], stableIdMap: Map<string, string>) {
  return uniqueStrings(personStableIds.map((stableId) => stableIdMap.get(stableId) ?? stableId));
}

function createProjectInputs(githubRepos: Awaited<ReturnType<typeof fetchGitHubTrendingRepos>>): ProjectInput[] {
  return githubRepos.map((repo) => ({
    ownerType: repo.owner.type,
    stableId: `repo:${repo.fullName.toLowerCase()}`,
    repoName: repo.fullName,
    repoUrl: repo.htmlUrl,
    ownerName: repo.owner.login,
    ownerUrl: repo.owner.htmlUrl,
    stars: repo.stars,
    starDelta7d: Math.max(repo.todayStars, 40),
    todayStars: repo.todayStars,
    contributorsCount: repo.contributorsCount,
    repoCreatedAt: repo.createdAt,
    repoUpdatedAt: repo.updatedAt,
    repoDescriptionRaw: repo.description,
    readmeExcerptRaw: repo.readmeExcerpt,
    githubContributors: repo.contributors.map((contributor) => ({
      login: contributor.login,
      htmlUrl: contributor.htmlUrl,
      type: contributor.type,
      contributions: contributor.contributions,
    })),
  }));
}

function mapStoredProjectToInput(project: StoredProjectRecord): ProjectInput {
  return {
    stableId: project.stableId,
    repoName: project.repoName,
    repoUrl: project.repoUrl,
    ownerName: project.ownerName,
    ownerUrl: project.ownerUrl,
    stars: project.stars,
    starDelta7d: project.starDelta7d,
    contributorsCount: project.contributorsCount,
    repoCreatedAt: project.repoCreatedAt,
    repoUpdatedAt: project.repoUpdatedAt,
    repoDescriptionRaw: project.repoDescriptionRaw,
    readmeExcerptRaw: project.readmeExcerptRaw,
    relatedPaperStableIds: readStringArray(project.relatedPaperIdsJson),
  };
}

async function loadGitHubFallbackProjectInputs(prisma: ArxivRefreshFallbackPrisma, limit: number) {
  const activeDataset = await prisma.datasetVersion.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true },
  });

  if (!activeDataset) {
    return [];
  }

  const events = await prisma.event.findMany({
    where: {
      datasetVersionId: activeDataset.id,
      sourceType: "github",
    },
    include: {
      projectLinks: {
        include: {
          project: {
            select: {
              stableId: true,
              repoName: true,
              repoUrl: true,
              ownerName: true,
              ownerUrl: true,
              stars: true,
              starDelta7d: true,
              contributorsCount: true,
              repoCreatedAt: true,
              repoUpdatedAt: true,
              repoDescriptionRaw: true,
              readmeExcerptRaw: true,
              relatedPaperIdsJson: true,
            },
          },
        },
      },
    },
    orderBy: { displayRank: "asc" },
    take: limit,
  });

  const projects = new Map<string, ProjectInput>();

  for (const event of events) {
    for (const link of event.projectLinks) {
      if (!projects.has(link.project.stableId)) {
        projects.set(link.project.stableId, mapStoredProjectToInput(link.project));
      }
    }
  }

  return [...projects.values()].slice(0, limit);
}

export async function loadGitHubProjectsForRefresh(
  prisma: ArxivRefreshFallbackPrisma,
  limit = GITHUB_REFRESH_FETCH_LIMIT,
): Promise<{ projects: ProjectInput[]; warning: string | null }> {
  try {
    return {
      projects: createProjectInputs(await fetchGitHubTrendingRepos(limit)),
      warning: null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown fetch error";
    console.warn("GitHub live fetch fallback:", reason);

    const fallbackProjects = await loadGitHubFallbackProjectInputs(prisma, limit);

    if (fallbackProjects.length > 0) {
      return {
        projects: fallbackProjects,
        warning: `GitHub 临时不可用，已回退到当前活跃数据集的 ${fallbackProjects.length} 个项目`,
      };
    }

    return {
      projects: [],
      warning: "GitHub 临时不可用，且没有可用缓存，本次已跳过 GitHub 更新",
    };
  }
}

function createPaperInputs(arxivPapers: Awaited<ReturnType<typeof fetchArxivPapers>>): PaperInput[] {
  return arxivPapers.map((paper) => ({
    stableId: `paper:${slugify(paper.title)}`,
    paperTitle: paper.title,
    paperUrl: paper.arxivUrl,
    authors: paper.authors,
    authorsCount: paper.authors.length,
    publishedAt: paper.publishedAt,
    abstractRaw: paper.summary,
    pdfTextRaw: paper.pdfTextRaw,
    semanticScholarUrl: paper.semanticScholarUrl,
    authorEmailsRaw: paper.authorEmailsRaw,
    institutionNamesRaw: paper.institutionNamesRaw,
  }));
}

function mapStoredPaperToInput(paper: StoredPaperRecord): PaperInput {
  return {
    stableId: paper.stableId,
    paperTitle: paper.paperTitle,
    paperUrl: paper.paperUrl,
    authors: readStringArray(paper.authorsJson),
    authorsCount: paper.authorsCount,
    publishedAt: paper.publishedAt,
    abstractRaw: paper.abstractRaw,
    pdfTextRaw: paper.pdfTextRaw,
    codeUrl: paper.codeUrl,
    authorEmailsRaw: readStringArray(paper.authorEmailsRaw),
    institutionNamesRaw: readStringArray(paper.institutionNamesRaw),
    relatedProjectStableIds: readStringArray(paper.relatedProjectIds),
  };
}

async function loadArxivFallbackPaperInputs(prisma: ArxivRefreshFallbackPrisma, limit: number) {
  const activeDataset = await prisma.datasetVersion.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true },
  });

  if (!activeDataset) {
    return [];
  }

  const events = await prisma.event.findMany({
    where: {
      datasetVersionId: activeDataset.id,
      sourceType: "arxiv",
    },
    include: {
      paperLinks: {
        include: {
          paper: {
            select: {
              stableId: true,
              paperTitle: true,
              paperUrl: true,
              authorsJson: true,
              authorsCount: true,
              publishedAt: true,
              abstractRaw: true,
              pdfTextRaw: true,
              codeUrl: true,
              authorEmailsRaw: true,
              institutionNamesRaw: true,
              relatedProjectIds: true,
            },
          },
        },
      },
    },
    orderBy: { displayRank: "asc" },
    take: limit,
  });

  const papers = new Map<string, PaperInput>();

  for (const event of events) {
    for (const link of event.paperLinks) {
      if (!papers.has(link.paper.stableId)) {
        papers.set(link.paper.stableId, mapStoredPaperToInput(link.paper));
      }
    }
  }

  return [...papers.values()].slice(0, limit);
}

export async function loadArxivPapersForRefresh(
  prisma: ArxivRefreshFallbackPrisma,
  limit = ARXIV_ACTIVE_POOL_LIMIT,
): Promise<{ papers: PaperInput[]; warning: string | null }> {
  try {
    return {
      papers: createPaperInputs(await fetchArxivPapers(limit)),
      warning: null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown fetch error";
    console.warn("arXiv live fetch fallback:", reason);

    const fallbackPapers = await loadArxivFallbackPaperInputs(prisma, limit);

    if (fallbackPapers.length > 0) {
      return {
        papers: fallbackPapers,
        warning: `arXiv 临时不可用，已回退到当前活跃数据集的 ${fallbackPapers.length} 篇论文`,
      };
    }

    return {
      papers: [],
      warning: "arXiv 临时不可用，且没有可用缓存，本次已跳过 arXiv 更新",
    };
  }
}

function buildRepoPaperLinks(projects: ProjectInput[], papers: PaperInput[]) {
  const repoPaperLinks: RepoPaperLinkInput[] = [];

  for (const project of projects) {
    for (const paper of papers) {
      const decision = decideRepoPaperLink({
        projectTitle: project.repoName,
        paperTitle: paper.paperTitle,
        readmeText: project.readmeExcerptRaw,
        projectDescription: project.repoDescriptionRaw,
        paperCodeUrl: paper.codeUrl,
        paperUrl: paper.paperUrl,
      });

      if (decision.confidence === "none") {
        continue;
      }

      repoPaperLinks.push({
        projectStableId: project.stableId,
        paperStableId: paper.stableId,
        evidenceType: decision.evidenceType,
        evidenceSourceUrl: project.repoUrl,
        evidenceExcerpt: decision.evidenceExcerpt,
        confidence: decision.confidence === "confirmed" ? "confirmed" : "candidate",
      });
    }
  }

  return repoPaperLinks;
}

function countGitHubPeopleCandidates(projects: ProjectInput[]) {
  const identities = new Set<string>();

  for (const project of projects) {
    identities.add(project.ownerName.toLowerCase());

    for (const contributor of project.githubContributors ?? []) {
      if (contributor.login) {
        identities.add(contributor.login.toLowerCase());
      }
    }
  }

  return identities.size;
}

function buildConfirmedLinkIndex(repoPaperLinks: RepoPaperLinkInput[]) {
  const byProject = new Map<string, RepoPaperLinkInput[]>();
  const byPaper = new Map<string, RepoPaperLinkInput[]>();

  for (const repoPaperLink of repoPaperLinks) {
    if (repoPaperLink.confidence !== "confirmed") {
      continue;
    }

    const projectLinks = byProject.get(repoPaperLink.projectStableId) ?? [];
    projectLinks.push(repoPaperLink);
    byProject.set(repoPaperLink.projectStableId, projectLinks);

    const paperLinks = byPaper.get(repoPaperLink.paperStableId) ?? [];
    paperLinks.push(repoPaperLink);
    byPaper.set(repoPaperLink.paperStableId, paperLinks);
  }

  return { byProject, byPaper };
}

function buildGitHubEvents(
  githubProjects: ProjectInput[],
  paperByStableId: Map<string, PaperInput>,
  confirmedLinksByProject: Map<string, RepoPaperLinkInput[]>,
) {
  return githubProjects.map((project, index) => {
    const matchingLinks = confirmedLinksByProject.get(project.stableId) ?? [];
    const linkedPaper = matchingLinks.map((link) => paperByStableId.get(link.paperStableId)).find(Boolean);
    const tag = classifyEventTag([project.repoName, project.repoDescriptionRaw ?? "", project.readmeExcerptRaw ?? ""]);
    const baseHighlight = buildGitHubProjectIntroZh(project, tag.tag);
    const ownerStableId = githubStableId(project.ownerName);
    const contributorEntries = (project.githubContributors ?? []).map((contributor) => ({
      stableId: githubStableId(contributor.login),
      contributionCount: contributor.contributions,
      isOwner: contributor.login.toLowerCase() === project.ownerName.toLowerCase(),
    }));
    const ownerContributionCount =
      contributorEntries.find((entry) => entry.stableId === ownerStableId)?.contributionCount ?? 0;
    const orderedPersonStableIds = uniqueStrings(
      [
        {
          stableId: ownerStableId,
          contributionCount: ownerContributionCount,
          isOwner: true,
        },
        ...contributorEntries,
      ]
        .sort((left, right) => {
          if (right.contributionCount !== left.contributionCount) {
            return right.contributionCount - left.contributionCount;
          }

          if (left.isOwner !== right.isOwner) {
            return left.isOwner ? -1 : 1;
          }

          return left.stableId.localeCompare(right.stableId);
        })
        .map((entry) => entry.stableId),
    );

    return {
      stableId: `event:github:${slugify(project.repoName)}`,
      sourceType: "github",
      eventType: linkedPaper ? "implementation" : project.repoCreatedAt > subDays(new Date(), 7) ? "new_repo" : "activity_spike",
      eventTag: tag.tag,
      eventTagConfidence: tag.confidence,
      eventTitleZh: clampZh(repoDisplayName(project.repoName), 32),
      eventHighlightZh: baseHighlight,
      eventDetailSummaryZh: clampZh(
        project.marketContextSnippetsRaw?.find(Boolean) ?? project.repoDescriptionRaw ?? project.readmeExcerptRaw ?? baseHighlight,
        64,
      ),
      timePrimary: project.repoUpdatedAt,
      metrics: [
        metric("时间", formatDay(project.repoUpdatedAt)),
        metric("today stars", `+${project.todayStars ?? project.starDelta7d}`),
        metric("Total Stars", countFormatter.format(project.stars)),
      ],
      sourceLinks: uniqueLinkItems([
        link("GitHub", project.repoUrl),
        ...(linkedPaper ? [link("Paper", linkedPaper.paperUrl)] : []),
        ...((project.marketContextLinks ?? []).slice(0, 2)),
      ]),
      peopleDetectionStatus: orderedPersonStableIds.length > 0 ? "resolved" : "missing",
      projectStableIds: [project.stableId],
      paperStableIds: linkedPaper ? [linkedPaper.stableId] : [],
      personStableIds: orderedPersonStableIds,
      displayRank: index + 1,
      relatedRepoCount: 1,
      relatedPaperCount: linkedPaper ? 1 : 0,
    } satisfies EventInput;
  });
}

function buildArxivEvents(papers: PaperInput[], confirmedLinksByPaper: Map<string, RepoPaperLinkInput[]>) {
  return papers.map((paper, index) => {
    const linkedProjects = confirmedLinksByPaper.get(paper.stableId) ?? [];
    const tag = classifyEventTag([paper.paperTitle, paper.pdfTextRaw ?? paper.abstractRaw ?? ""]);
    const type = linkedProjects.length > 0 ? (paper.codeUrl ? "paper_with_code" : "implementation") : "new_paper";
    const fallbackSummary = buildPaperExplanationZh({
      paperTitle: paper.paperTitle,
      contentRaw: paper.pdfTextRaw,
      abstractRaw: paper.abstractRaw,
      eventTag: tag.tag,
      hasCode: Boolean(paper.codeUrl || linkedProjects.length > 0),
      relatedRepoCount: linkedProjects.length,
    }).lead;

    return {
      stableId: `event:arxiv:${slugify(paper.paperTitle)}`,
      sourceType: "arxiv",
      eventType: type,
      eventTag: tag.tag,
      eventTagConfidence: tag.confidence,
      eventTitleZh: clampZh(
        type === "new_paper" ? `新 paper “${paper.paperTitle}” 发布` : `Paper “${paper.paperTitle}” 已连接代码`,
        32,
      ),
      eventHighlightZh: sentenceZh(type === "new_paper" ? "相关论文流中出现新的研究入口。" : "研究入口已经连接到更可执行的实现。", 20),
      eventDetailSummaryZh: clampZh(fallbackSummary, 64),
      timePrimary: paper.publishedAt,
      metrics: [
        metric("时间", "近期"),
        metric("authors", String(paper.authorsCount)),
        metric("code", linkedProjects.length > 0 || paper.codeUrl ? "有" : "无"),
      ],
      sourceLinks: [
        link("Paper", paper.paperUrl),
        ...(paper.semanticScholarUrl ? [link("Semantic Scholar", paper.semanticScholarUrl)] : []),
        ...(paper.codeUrl ? [link("Code", paper.codeUrl)] : []),
      ],
      peopleDetectionStatus: paper.authors.length > 0 ? "partial" : "missing",
      projectStableIds: linkedProjects.map((record) => record.projectStableId),
      paperStableIds: [paper.stableId],
      personStableIds: paper.authors.map((name) => `author:${slugify(name)}`),
      displayRank: index + 1,
      relatedRepoCount: linkedProjects.length,
      relatedPaperCount: 1,
    } satisfies EventInput;
  });
}

function buildKickstarterEvents(campaigns: KickstarterCampaign[]) {
  return campaigns.map((campaign, index) => {
    const tag = classifyEventTag([campaign.campaignName, campaign.summaryRaw]);
    const personStableIds = campaign.creatorName ? [kickstarterStableId(campaign)] : [];

    return {
      stableId: `event:kickstarter:${slugify(campaign.campaignUrl || campaign.campaignName)}`,
      sourceType: "kickstarter",
      eventType: "activity_spike",
      eventTag: tag.tag,
      eventTagConfidence: tag.confidence,
      eventTitleZh: clampZh(campaign.campaignName, 32),
      eventHighlightZh: buildKickstarterHighlight(campaign, tag.tag),
      eventDetailSummaryZh: buildKickstarterDetailSummary(campaign, tag.tag),
      timePrimary: campaign.collectedAt,
      metrics: [
        metric("Pledged", campaign.pledgedLabel || formatKickstarterMoney(campaign.pledgedAmount)),
        metric("Goal", campaign.goalLabel || formatKickstarterMoney(campaign.goalAmount)),
        metric("Backers", campaign.backersLabel || formatKickstarterCount(campaign.backersCount)),
        campaign.daysLeftLabel ? metric("Days Left", campaign.daysLeftLabel) : metric("Status", campaign.statusLabel || "Unknown"),
      ],
      sourceLinks: uniqueLinkItems([
        link("Kickstarter", campaign.campaignUrl),
        ...(campaign.creatorUrl ? [link("Creator", campaign.creatorUrl)] : []),
      ]),
      peopleDetectionStatus: personStableIds.length > 0 ? "partial" : "missing",
      projectStableIds: [],
      paperStableIds: [],
      personStableIds,
      displayRank: index + 1,
      relatedRepoCount: 0,
      relatedPaperCount: 0,
    } satisfies EventInput;
  });
}

function mapFallbackKickstarterEventToInput(event: KickstarterFallbackEventRecord): EventInput {
  return {
    stableId: event.stableId,
    sourceType: "kickstarter",
    eventType: event.eventType,
    eventTag: event.eventTag as EventInput["eventTag"],
    eventTagConfidence: event.eventTagConfidence,
    eventTitleZh: event.eventTitleZh,
    eventHighlightZh: event.eventHighlightZh,
    eventDetailSummaryZh: event.eventDetailSummaryZh ?? null,
    timePrimary: event.timePrimary,
    metrics: parseMetrics(event.metricsJson),
    sourceLinks: parseLinks(event.sourceLinksJson),
    peopleDetectionStatus: event.peopleDetectionStatus,
    projectStableIds: [],
    paperStableIds: [],
    personStableIds: event.personLinks.map((link) => link.person.stableId),
    displayRank: event.displayRank,
    relatedRepoCount: event.relatedRepoCount,
    relatedPaperCount: event.relatedPaperCount,
  };
}

function mapFallbackKickstarterPeople(events: KickstarterFallbackEventRecord[]) {
  const people = new Map<string, PersonInput>();

  for (const event of events) {
    for (const link of event.personLinks) {
      if (people.has(link.person.stableId)) {
        continue;
      }

      people.set(link.person.stableId, {
        stableId: link.person.stableId,
        name: link.person.name,
        identitySummaryZh: link.person.identitySummaryZh,
        evidenceSummaryZh: link.person.evidenceSummaryZh,
        sourceUrls: readStringArray(link.person.sourceUrlsJson),
        githubUrl: link.person.githubUrl,
        scholarUrl: link.person.scholarUrl,
        linkedinUrl: link.person.linkedinUrl,
        xUrl: link.person.xUrl,
        homepageUrl: link.person.homepageUrl,
        email: link.person.email,
        organizationNamesRaw: readStringArray(link.person.organizationNamesRaw),
        schoolNamesRaw: readStringArray(link.person.schoolNamesRaw),
        labNamesRaw: readStringArray(link.person.labNamesRaw),
        bioSnippetsRaw: readStringArray(link.person.bioSnippetsRaw),
        founderHistoryRaw: readStringArray(link.person.founderHistoryRaw),
      });
    }
  }

  return [...people.values()];
}

async function loadKickstarterFallbackCampaigns(prisma: ArxivRefreshFallbackPrisma, limit: number) {
  const activeDataset = await prisma.datasetVersion.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true },
  });

  if (!activeDataset) {
    return {
      events: [] as EventInput[],
      people: [] as PersonInput[],
    };
  }

  const events = await prisma.event.findMany({
    where: {
      datasetVersionId: activeDataset.id,
      sourceType: "kickstarter",
    },
    include: {
      personLinks: {
        orderBy: { position: "asc" },
        include: { person: true },
      },
    },
    orderBy: { displayRank: "asc" },
    take: limit,
  });

  return {
    events: events.map(mapFallbackKickstarterEventToInput),
    people: mapFallbackKickstarterPeople(events),
  };
}

export async function loadKickstarterCampaignsForRefresh(
  prisma: ArxivRefreshFallbackPrisma,
  limit = KICKSTARTER_REFRESH_FETCH_LIMIT,
): Promise<{ events: EventInput[]; people: PersonInput[]; warning: string | null }> {
  try {
    const campaigns = await fetchKickstarterCampaigns(limit);

    if (campaigns.length > 0) {
      return {
        events: buildKickstarterEvents(campaigns),
        people: campaigns.map(personFromKickstarterCreator).filter(Boolean) as PersonInput[],
        warning: null,
      };
    }

    const fallback = await loadKickstarterFallbackCampaigns(prisma, limit);

    if (fallback.events.length > 0) {
      return {
        ...fallback,
        warning: `Kickstarter 暂未抓到可用项目，已回退到当前活跃数据集的 ${fallback.events.length} 个 campaign`,
      };
    }

    return {
      events: [],
      people: [],
      warning: "Kickstarter 暂未抓到可用项目，且没有可用缓存，本次已跳过 Kickstarter 更新",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown fetch error";
    console.warn("Kickstarter live fetch fallback:", reason);

    const fallback = await loadKickstarterFallbackCampaigns(prisma, limit);

    if (fallback.events.length > 0) {
      return {
        ...fallback,
        warning: `Kickstarter 临时不可用，已回退到当前活跃数据集的 ${fallback.events.length} 个 campaign`,
      };
    }

    return {
      events: [],
      people: [],
      warning: "Kickstarter 临时不可用，且没有可用缓存，本次已跳过 Kickstarter 更新",
    };
  }
}

function buildLiveDatasetBundle(
  githubProjects: ProjectInput[],
  papers: PaperInput[],
  people: PersonInput[],
  repoPaperLinks: RepoPaperLinkInput[],
  extraEvents: EventInput[] = [],
): DatasetBundleInput {
  const paperByStableId = new Map(papers.map((paper) => [paper.stableId, paper]));
  const confirmedLinkIndex = buildConfirmedLinkIndex(repoPaperLinks);
  const githubEvents = buildGitHubEvents(githubProjects, paperByStableId, confirmedLinkIndex.byProject);
  const arxivEvents = buildArxivEvents(papers, confirmedLinkIndex.byPaper);
  const mergedPeople = mergePeopleConservatively(people);
  const remappedEvents = [...githubEvents, ...extraEvents, ...arxivEvents].map((event) => ({
    ...event,
    personStableIds: remapPersonStableIds(event.personStableIds, mergedPeople.stableIdMap),
  }));

  return {
    label: "Live refresh",
    source: "refresh",
    projects: githubProjects,
    papers,
    people: mergedPeople.people,
    repoPaperLinks,
    events: remappedEvents,
  };
}

async function recoverStaleRefreshRuns(prisma: PrismaClient) {
  const staleThreshold = subMinutes(new Date(), STALE_REFRESH_MINUTES);

  await prisma.refreshRun.updateMany({
    where: {
      status: "RUNNING",
      startedAt: {
        lt: staleThreshold,
      },
    },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      message: `刷新超过 ${STALE_REFRESH_MINUTES} 分钟未完成，已自动回收`,
    },
  });
}

async function updateRefreshProgress(prisma: PrismaClient, refreshRunId: string, message: string) {
  await prisma.refreshRun.update({
    where: { id: refreshRunId },
    data: { message },
  });
}

async function createRefreshRun(prisma: PrismaClient, trigger: "manual" | "scheduled") {
  await recoverStaleRefreshRuns(prisma);

  const running = await prisma.refreshRun.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });

  if (running) {
    return {
      run: running,
      datasetVersionId: null,
      started: false,
    };
  }

  const refreshRunId = `refresh-${Date.now()}`;
  const datasetVersionId = `dataset-${Date.now()}`;
  const startedAt = new Date();

  const run = await prisma.refreshRun.create({
    data: {
      id: refreshRunId,
      trigger,
      status: "RUNNING",
      startedAt,
      message: buildRefreshStageMessage("queued"),
    },
  });

  return {
    run,
    datasetVersionId,
    started: true,
  };
}

async function executeRefreshRun(prisma: PrismaClient, refreshRunId: string, datasetVersionId: string) {
  try {
    await updateRefreshProgress(prisma, refreshRunId, buildRefreshStageMessage("ingest"));

    const [githubResult, kickstarterResult, arxivResult] = await Promise.all([
      loadGitHubProjectsForRefresh(prisma, GITHUB_REFRESH_FETCH_LIMIT),
      loadKickstarterCampaignsForRefresh(prisma, KICKSTARTER_REFRESH_FETCH_LIMIT),
      loadArxivPapersForRefresh(prisma, ARXIV_ACTIVE_POOL_LIMIT),
    ]);
    const sourceWarnings = [githubResult.warning, kickstarterResult.warning, arxivResult.warning].filter(
      (warning): warning is string => Boolean(warning),
    );

    await updateRefreshProgress(prisma, refreshRunId, buildRefreshStageMessage("normalize"));

    const githubProjectsBase = githubResult.projects;
    const githubProjects =
      githubProjectsBase.length > 0
        ? await enrichGitHubProjectsWithNarrativeContext(githubProjectsBase, async ({ completed, total, repoName }) => {
            const progress = buildRefreshRangeProgress(28, 38, completed, total);
            await updateRefreshProgress(
              prisma,
              refreshRunId,
              buildRefreshStageMessage("normalize", `补充 GitHub 中文互联网语境 (${completed}/${total}) · ${repoName}`).replace(
                "progress::28",
                `progress::${progress}`,
              ),
            );
          })
        : githubProjectsBase;
    const papers = arxivResult.papers;
    const ownerCount = countGitHubPeopleCandidates(githubProjects);

    await updateRefreshProgress(
      prisma,
      refreshRunId,
      buildRefreshStageMessage("people", ownerCount > 0 ? `0/${ownerCount}` : undefined),
    );

    const people = await (async () => {
      const githubOwners = await enrichGitHubOwners(githubProjects, async ({ completed, total }) => {
        const progress = buildRefreshRangeProgress(getRefreshStageCopy("people").progress, 58, completed, total);
        await updateRefreshProgress(
          prisma,
          refreshRunId,
          buildRefreshStageMessage("people", `${completed}/${total}`).replace("progress::40", `progress::${progress}`),
        );
      });
      const githubOwnerIds = new Set(githubOwners.map((person) => person.stableId));
      const authorPeople = uniqueStrings(papers.flatMap((paper) => paper.authors))
        .map((name) => personFromAuthor(name))
        .filter((person) => !githubOwnerIds.has(person.stableId));

      return [...githubOwners, ...authorPeople, ...kickstarterResult.people];
    })();

    await updateRefreshProgress(prisma, refreshRunId, buildRefreshStageMessage("link"));
    const repoPaperLinks = buildRepoPaperLinks(githubProjects, papers);

    const bundle =
      githubProjects.length > 0 || papers.length > 0 || kickstarterResult.events.length > 0
        ? buildLiveDatasetBundle(githubProjects, papers, people, repoPaperLinks, kickstarterResult.events)
        : buildSampleDataset();

    await updateRefreshProgress(prisma, refreshRunId, buildRefreshStageMessage("ai"));

    const aiResult = await enrichBundleWithOpenAI(bundle, {
      enrichPeople: false,
      eventLimit: AI_EVENT_ENRICH_LIMIT,
      onProgress: async ({ phase, completedItems, totalItems }) => {
        const progress = phase === "events"
          ? buildRefreshRangeProgress(getRefreshStageCopy("ai").progress, 89, completedItems, totalItems)
          : buildRefreshRangeProgress(84, 89, completedItems, totalItems);
        const detail = phase === "events" ? `events ${completedItems}/${totalItems}` : `people ${completedItems}/${totalItems}`;
        await updateRefreshProgress(
          prisma,
          refreshRunId,
          buildRefreshStageMessage("ai", detail).replace(`progress::${getRefreshStageCopy("ai").progress}`, `progress::${progress}`),
        );
      },
    });

    if (aiResult.errors.length > 0) {
      console.warn("OpenAI enrichment fallback:", aiResult.errors.join(" | "));
    }

    await updateRefreshProgress(prisma, refreshRunId, buildRefreshStageMessage("validate"));

    await prisma.$transaction(async (tx) => {
      await tx.datasetVersion.create({
        data: {
          id: datasetVersionId,
          label: aiResult.bundle.label,
          source: aiResult.bundle.source,
          status: "DRAFT",
        },
      });

      await persistDataset(tx, datasetVersionId, aiResult.bundle);

      await tx.refreshRun.update({
        where: { id: refreshRunId },
        data: {
          message: buildRefreshStageMessage("publish"),
        },
      });

      await tx.datasetVersion.updateMany({
        where: { status: "ACTIVE" },
        data: { status: "ARCHIVED" },
      });

      await tx.datasetVersion.update({
        where: { id: datasetVersionId },
        data: {
          status: "ACTIVE",
          publishedAt: new Date(),
        },
      });

      await tx.refreshRun.update({
        where: { id: refreshRunId },
        data: {
          datasetVersionId,
          status: "SUCCESS",
          finishedAt: new Date(),
          message: buildRefreshMessage(aiResult.bundle.events.length, {
            aiEnabled: aiResult.enabled,
            aiEventCount: aiResult.eventCount,
            aiPersonCount: aiResult.personCount,
            aiErrors: aiResult.errors,
            sourceWarnings,
          }),
        },
      });
    });

    return prisma.refreshRun.findUniqueOrThrow({
      where: { id: refreshRunId },
    });
  } catch (error) {
    await prisma.refreshRun.update({
      where: { id: refreshRunId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        message: error instanceof Error ? error.message : "刷新失败",
      },
    });

    throw error;
  }
}

export async function runRefresh(prisma: PrismaClient, trigger: "manual" | "scheduled" = "manual") {
  const created = await createRefreshRun(prisma, trigger);

  if (!created.started || !created.datasetVersionId) {
    throw new Error("已有刷新任务正在运行");
  }

  return executeRefreshRun(prisma, created.run.id, created.datasetVersionId);
}

export async function kickoffRefresh(prisma: PrismaClient, trigger: "manual" | "scheduled" = "manual") {
  const created = await createRefreshRun(prisma, trigger);

  if (created.started && created.datasetVersionId) {
    setTimeout(() => {
      void executeRefreshRun(prisma, created.run.id, created.datasetVersionId!).catch((error) => {
        console.warn("background refresh failed:", error instanceof Error ? error.message : "unknown error");
      });
    }, 0);
  }

  return {
    run: created.run,
    started: created.started,
    snapshot: toRefreshStatusSnapshot(created.run),
  };
}

export async function getRefreshStatus(prisma: PrismaClient, runId?: string | null) {
  const run = runId
    ? await prisma.refreshRun.findUnique({
        where: { id: runId },
      })
    : await prisma.refreshRun.findFirst({
        orderBy: { startedAt: "desc" },
      });

  return run ? toRefreshStatusSnapshot(run) : null;
}

export { buildLiveDatasetBundle };
