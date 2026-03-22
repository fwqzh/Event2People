import { subDays } from "date-fns";
import { PrismaClient } from "@prisma/client";

import { classifyEventTag } from "@/lib/event-tag";
import { shouldMergePeople } from "@/lib/merge-people";
import { enrichBundleWithOpenAI } from "@/lib/openai-enrichment";
import { decideRepoPaperLink } from "@/lib/repo-paper-linking";
import { buildSampleDataset } from "@/lib/sample-data";
import { persistDataset } from "@/lib/seed";
import { fetchArxivPapers } from "@/lib/sources/arxiv";
import { fetchGitHubTrendingRepos } from "@/lib/sources/github";
import { clampZh, repoDisplayName, sentenceZh, slugify, uniqueStrings } from "@/lib/text";
import type { DatasetBundleInput, EventInput, PaperInput, PersonInput, ProjectInput, RepoPaperLinkInput } from "@/lib/types";

const REFRESH_FETCH_LIMIT = 10;

function metric(label: string, value: string) {
  return { label, value };
}

function link(label: string, url: string) {
  return { label, url };
}

function summarizeGitHubProjectZh(project: ProjectInput, fallbackTag: string) {
  const text = `${project.repoDescriptionRaw ?? ""} ${project.readmeExcerptRaw ?? ""}`.toLowerCase();

  if (text.includes("browser")) {
    return sentenceZh("用于浏览器工作流的 agent 执行循环。", 20);
  }

  if (text.includes("multimodal") || text.includes("vlm")) {
    return sentenceZh("用于多模态推理与规划的研究栈。", 20);
  }

  if (text.includes("voice") || text.includes("speech")) {
    return sentenceZh("用于语音交互与规划的 agent 运行时。", 20);
  }

  if (text.includes("simulation") || text.includes("world model")) {
    return sentenceZh("用于具身模拟与 world model 研究。", 20);
  }

  if (text.includes("eval") || text.includes("benchmark")) {
    return sentenceZh("用于评测与编排的开源基础设施。", 20);
  }

  if (text.includes("robot") || text.includes("embodied")) {
    return sentenceZh("用于具身智能任务执行与规划。", 20);
  }

  return sentenceZh(`这是一个聚焦 ${fallbackTag} 的 GitHub 项目。`, 20);
}

function buildRefreshMessage(eventCount: number, options: { aiEnabled: boolean; aiEventCount: number; aiPersonCount: number; aiErrors: string[] }) {
  const parts = [`刷新完成：${eventCount} 个 event`];

  if (!options.aiEnabled) {
    parts.push("未配置 OpenAI，已使用模板文案");
    return parts.join(" · ");
  }

  if (options.aiEventCount > 0 || options.aiPersonCount > 0) {
    parts.push(`AI enriched ${options.aiEventCount} 条 event / ${options.aiPersonCount} 位人物`);
  } else {
    parts.push("AI 已启用，但本次未改写文案");
  }

  if (options.aiErrors.length > 0) {
    parts.push("部分 AI enrichment 已回退");
  }

  return parts.join(" · ");
}

function personFromGitHubOwner(ownerLogin: string, ownerUrl: string): PersonInput {
  const displayName = ownerLogin
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return {
    stableId: `github:${ownerLogin.toLowerCase()}`,
    name: displayName,
    identitySummaryZh: clampZh("GitHub 构建者 · Frontier repo owner", 36),
    evidenceSummaryZh: clampZh("创建相关 repo；主导当前事件", 24),
    sourceUrls: [ownerUrl],
    githubUrl: ownerUrl,
    organizationNamesRaw: [],
  };
}

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

function mergePeopleConservatively(people: PersonInput[]) {
  const merged: PersonInput[] = [];

  for (const person of people) {
    const existing = merged.find((candidate) => shouldMergePeople(candidate, person).shouldMerge);

    if (!existing) {
      merged.push(person);
    }
  }

  return merged;
}

function createProjectInputs(githubRepos: Awaited<ReturnType<typeof fetchGitHubTrendingRepos>>): ProjectInput[] {
  return githubRepos.map((repo) => ({
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
  }));
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
    semanticScholarUrl: paper.semanticScholarUrl,
  }));
}

function buildPeopleInputs(githubProjects: ProjectInput[], papers: PaperInput[]) {
  return uniqueStrings([...githubProjects.map((project) => project.ownerName), ...papers.flatMap((paper) => paper.authors)]).flatMap(
    (name) => {
      const githubProject = githubProjects.find((project) => project.ownerName === name);
      return githubProject ? [personFromGitHubOwner(githubProject.ownerName, githubProject.ownerUrl)] : [personFromAuthor(name)];
    },
  );
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
    const personStableId = `github:${slugify(project.ownerName)}`;

    return {
      stableId: `event:github:${slugify(project.repoName)}`,
      sourceType: "github",
      eventType: linkedPaper ? "implementation" : project.repoCreatedAt > subDays(new Date(), 7) ? "new_repo" : "activity_spike",
      eventTag: tag.tag,
      eventTagConfidence: tag.confidence,
      eventTitleZh: clampZh(repoDisplayName(project.repoName), 32),
      eventHighlightZh: summarizeGitHubProjectZh(project, tag.tag),
      eventDetailSummaryZh: linkedPaper
        ? `该项目已与 Paper “${linkedPaper.paperTitle}” 形成明确实现连接。`
        : "该项目近期进入高活跃区间，并已形成清晰人物与来源链接。",
      timePrimary: project.repoUpdatedAt,
      metrics: [
        metric("时间", "近期"),
        metric("today stars", `+${project.todayStars ?? project.starDelta7d}`),
        metric("contributors", String(project.contributorsCount)),
      ],
      sourceLinks: [link("GitHub", project.repoUrl), ...(linkedPaper ? [link("Paper", linkedPaper.paperUrl)] : [])],
      peopleDetectionStatus: "resolved",
      projectStableIds: [project.stableId],
      paperStableIds: linkedPaper ? [linkedPaper.stableId] : [],
      personStableIds: [personStableId],
      displayRank: index + 1,
      relatedRepoCount: 1,
      relatedPaperCount: linkedPaper ? 1 : 0,
    } satisfies EventInput;
  });
}

function buildArxivEvents(papers: PaperInput[], confirmedLinksByPaper: Map<string, RepoPaperLinkInput[]>) {
  return papers.map((paper, index) => {
    const linkedProjects = confirmedLinksByPaper.get(paper.stableId) ?? [];
    const tag = classifyEventTag([paper.paperTitle, paper.abstractRaw ?? ""]);
    const type = linkedProjects.length > 0 ? (paper.codeUrl ? "paper_with_code" : "implementation") : "new_paper";

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
      eventDetailSummaryZh: "论文与实现、人物关系可直接追溯到原始页面。",
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

function buildLiveDatasetBundle(githubProjects: ProjectInput[], papers: PaperInput[], people: PersonInput[], repoPaperLinks: RepoPaperLinkInput[]): DatasetBundleInput {
  const paperByStableId = new Map(papers.map((paper) => [paper.stableId, paper]));
  const confirmedLinkIndex = buildConfirmedLinkIndex(repoPaperLinks);
  const githubEvents = buildGitHubEvents(githubProjects, paperByStableId, confirmedLinkIndex.byProject);
  const arxivEvents = buildArxivEvents(papers, confirmedLinkIndex.byPaper);

  return {
    label: "Live refresh",
    source: "refresh",
    projects: githubProjects,
    papers,
    people: mergePeopleConservatively(people),
    repoPaperLinks,
    events: [...githubEvents, ...arxivEvents],
  };
}

export async function runRefresh(prisma: PrismaClient, trigger: "manual" | "scheduled" = "manual") {
  const running = await prisma.refreshRun.findFirst({
    where: { status: "RUNNING" },
  });

  if (running) {
    throw new Error("已有刷新任务正在运行");
  }

  const refreshRunId = `refresh-${Date.now()}`;
  const datasetVersionId = `dataset-${Date.now()}`;
  const startedAt = new Date();

  await prisma.refreshRun.create({
    data: {
      id: refreshRunId,
      trigger,
      status: "RUNNING",
      startedAt,
    },
  });

  try {
    const [githubRepos, arxivPapers] = await Promise.all([
      fetchGitHubTrendingRepos(REFRESH_FETCH_LIMIT),
      fetchArxivPapers(REFRESH_FETCH_LIMIT),
    ]);
    const githubProjects = createProjectInputs(githubRepos);
    const papers = createPaperInputs(arxivPapers);
    const people = buildPeopleInputs(githubProjects, papers);
    const repoPaperLinks = buildRepoPaperLinks(githubProjects, papers);

    const bundle =
      githubProjects.length > 0 || papers.length > 0
        ? buildLiveDatasetBundle(githubProjects, papers, people, repoPaperLinks)
        : buildSampleDataset();
    const aiResult = await enrichBundleWithOpenAI(bundle);

    if (aiResult.errors.length > 0) {
      console.warn("OpenAI enrichment fallback:", aiResult.errors.join(" | "));
    }

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

export { buildLiveDatasetBundle };
