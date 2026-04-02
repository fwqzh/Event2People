import { Prisma } from "@prisma/client";

import { buildPersonCopySummary } from "@/lib/copy";
import {
  buildGitHubCardSummaryZh,
  buildGitHubExpandedIntroZh,
  buildGitHubProjectIntroZh,
  looksLikeMalformedGitHubIntro,
} from "@/lib/github-copy";
import { generateGitHubProjectAnalysis } from "@/lib/github-project-analysis";
import { readStringArray } from "@/lib/json";
import { generatePaperAnalysis } from "@/lib/paper-analysis";
import { buildPaperExplanationZh, buildPaperTopicView } from "@/lib/paper-copy";
import { buildPersonLinks } from "@/lib/person-links";
import { resolvePaperRuntimeMetadata } from "@/lib/paper-runtime";
import { prisma } from "@/lib/prisma";
import { ensureActiveDataset, parseLinks, parseMetrics } from "@/lib/seed";
import { clampPlainText, compactInstitution, formatDay, timeAgo } from "@/lib/text";
import type { EventAnalysisView, EventDetailView, EventSummaryView, PersonPreviewView, PersonView, PipelineEntryView } from "@/lib/types";

type PersonRecord = {
  stableId: string;
  name: string;
  identitySummaryZh: string;
  evidenceSummaryZh: string;
  sourceUrlsJson: Prisma.JsonValue;
  githubUrl: string | null;
  scholarUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
  homepageUrl: string | null;
  email: string | null;
  organizationNamesRaw: Prisma.JsonValue | null;
  schoolNamesRaw: Prisma.JsonValue | null;
  labNamesRaw: Prisma.JsonValue | null;
  bioSnippetsRaw: Prisma.JsonValue | null;
  founderHistoryRaw: Prisma.JsonValue | null;
};

type ProjectRecord = {
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

type PaperRecord = {
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

type PersonLinkRecord = Pick<
  PersonRecord,
  "githubUrl" | "scholarUrl" | "linkedinUrl" | "xUrl" | "homepageUrl" | "email" | "sourceUrlsJson"
>;

type HomepageEventRecord = Prisma.EventGetPayload<{
  include: {
    projectLinks: {
      include: {
        project: true;
      };
    };
    paperLinks: {
      include: {
        paper: true;
      };
    };
    personLinks: {
      orderBy: {
        position: "asc",
      },
      include: {
        person: {
          select: {
            stableId: true;
            name: true;
            githubUrl: true;
            scholarUrl: true;
            linkedinUrl: true;
            xUrl: true;
            homepageUrl: true;
            email: true;
            sourceUrlsJson: true;
          };
        };
      };
    };
  };
}>;

type ActiveEventRecord = Prisma.EventGetPayload<{
  include: {
    personLinks: {
      orderBy: {
        position: "asc",
      },
      include: {
        person: true;
      };
    };
    projectLinks: {
      include: {
        project: true;
      };
    };
    paperLinks: {
      include: {
        paper: true;
      };
    };
  };
}>;

const CARD_SOURCE_SUMMARY_LIMIT = 220;
const DETAIL_SOURCE_SUMMARY_LIMIT = 560;
const HOMEPAGE_VISIBLE_LIMIT = 10;
const countFormatter = new Intl.NumberFormat("en-US");

function normalizeHomepageMetrics(
  sourceType: "github" | "arxiv",
  metrics: Array<{ label: string; value: string }>,
  projects: ProjectRecord[] = [],
) {
  if (sourceType !== "github") {
    return metrics;
  }

  const totalStars = projects.reduce((sum, project) => sum + project.stars, 0);
  const hasTotalStarsMetric = metrics.some((metric) => metric.label === "Total Stars");

  return metrics.map((metric) => {
    if (metric.label !== "stars 增量") {
      if (metric.label === "Total Stars") {
        const rawValue = metric.value.replace(/,/g, "").match(/\d+/)?.[0];

        return {
          label: "Total Stars",
          value: rawValue ? countFormatter.format(Number(rawValue)) : metric.value,
        };
      }

      if (metric.label !== "contributors") {
        return metric;
      }

      if (hasTotalStarsMetric || totalStars <= 0) {
        return metric;
      }

      return {
        label: "Total Stars",
        value: countFormatter.format(totalStars),
      };
    }

    return {
      label: "today stars",
      value: metric.value.replace(/\s*\/\s*7d$/i, "").trim(),
    };
  });
}

function extractTodayStars(metrics: Array<{ label: string; value: string }>) {
  const metric = metrics.find((item) => item.label === "today stars" || item.label === "stars 增量");

  if (!metric) {
    return 0;
  }

  const match = metric.value.replace(/,/g, "").match(/-?\d+/);
  return match ? Math.abs(Number(match[0])) : 0;
}

function compactCopy(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function clampCopy(text: string, limit: number) {
  return clampPlainText(text, limit);
}

function uniqueCopyParts(values: Array<string | null | undefined>) {
  const seen = new Set<string>();

  return values
    .map((value) => compactCopy(value))
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }

      seen.add(value);
      return true;
    });
}

function getSourceSummaryLabel(sourceType: "github" | "arxiv") {
  return sourceType === "github" ? "项目简介" : "论文概览";
}

function buildSourceSummary(
  sourceType: "github" | "arxiv",
  project: ProjectRecord | undefined,
  paper: PaperRecord | undefined,
  fallback: string,
  limit: number,
) {
  const summary =
    sourceType === "github"
      ? uniqueCopyParts([project?.repoDescriptionRaw]).join(" ")
      : uniqueCopyParts([paper?.pdfTextRaw, paper?.abstractRaw]).join(" ");

  return clampCopy(summary || fallback, limit);
}

function buildArxivNarrative(
  event: Pick<HomepageEventRecord, "eventTag" | "eventDetailSummaryZh" | "eventHighlightZh" | "relatedRepoCount">,
  paper: PaperRecord | undefined,
) {
  if (!paper) {
    const fallback = compactCopy(event.eventDetailSummaryZh) || compactCopy(event.eventHighlightZh);

    return {
      lead: fallback,
      problem: fallback,
      method: "当前缺少更完整的摘要，暂时只能从事件文案判断方法方向。",
      contribution: "当前主要价值在于把这篇论文作为后续继续核验和下钻的研究入口。",
    };
  }

  return buildPaperExplanationZh({
    paperTitle: paper.paperTitle,
    contentRaw: paper.pdfTextRaw,
    abstractRaw: paper.abstractRaw,
    eventTag: event.eventTag as EventSummaryView["eventTag"],
    hasCode: Boolean(paper.codeUrl || (event.relatedRepoCount ?? 0) > 0),
    relatedRepoCount: event.relatedRepoCount,
  });
}

function getPersonPrimaryInstitution(
  person:
    | Pick<PersonRecord, "organizationNamesRaw" | "schoolNamesRaw" | "labNamesRaw">
    | Pick<PersonView, "organizationNamesRaw" | "schoolNamesRaw" | "labNamesRaw">,
) {
  return compactInstitution(
    readStringArray(person.organizationNamesRaw)[0] ??
      readStringArray(person.schoolNamesRaw)[0] ??
      readStringArray(person.labNamesRaw)[0] ??
      "",
  );
}

function buildArxivSummaryMetadata(
  event: Pick<HomepageEventRecord, "eventTag"> | Pick<ActiveEventRecord, "eventTag">,
  paper: PaperRecord | undefined,
) {
  if (!paper) {
    return {
      publishedAtLabel: "",
      publishedAtTs: 0,
      keywords: [],
      topic: event.eventTag as EventSummaryView["eventTag"],
    };
  }

  const topicView = buildPaperTopicView({
    paperTitle: paper.paperTitle,
    contentRaw: paper.pdfTextRaw,
    abstractRaw: paper.abstractRaw,
    eventTag: event.eventTag as EventSummaryView["eventTag"],
  });

  return {
    publishedAtLabel: formatDay(paper.publishedAt),
    publishedAtTs: paper.publishedAt.getTime(),
    keywords: topicView.keywords,
    topic: topicView.topic,
  };
}

async function buildArxivMetadata(
  event: Pick<ActiveEventRecord, "eventTag">,
  paper: PaperRecord | undefined,
  people: ActiveEventRecord["personLinks"],
) {
  const summaryMetadata = buildArxivSummaryMetadata(event, paper);

  if (!paper) {
    return {
      ...summaryMetadata,
      authors: [],
      authorEmails: [],
      institutions: [],
      leadAuthorAffiliations: [],
    };
  }

  const runtimeMetadata = await resolvePaperRuntimeMetadata({
    cacheKey: paper.stableId,
    paperUrl: paper.paperUrl,
    authors: readStringArray(paper.authorsJson),
    authorEmails: readStringArray(paper.authorEmailsRaw),
    institutionNames: readStringArray(paper.institutionNamesRaw),
    pdfTextRaw: paper.pdfTextRaw,
  });
  const institutionsFromPeople = people.map((link) => getPersonPrimaryInstitution(link.person)).filter(Boolean);
  const institutions = runtimeMetadata.institutionNames.length > 0 ? runtimeMetadata.institutionNames : institutionsFromPeople;

  return {
    ...summaryMetadata,
    authors: runtimeMetadata.authors,
    authorEmails: runtimeMetadata.authorEmails,
    institutions: [...new Set(institutions)].slice(0, 3),
    leadAuthorAffiliations: runtimeMetadata.leadAuthorAffiliations,
  };
}

function getGitHubNarrativeSummary(
  event: Pick<HomepageEventRecord, "eventDetailSummaryZh"> | Pick<ActiveEventRecord, "eventDetailSummaryZh">,
  project: ProjectRecord | undefined,
  safeHighlight: string,
) {
  const generatedSummary = compactCopy(event.eventDetailSummaryZh);

  if (
    generatedSummary &&
    !/近期进入高活跃区间|形成清晰人物与来源链接|明确实现连接/.test(generatedSummary)
  ) {
    return generatedSummary;
  }

  return buildGitHubCardSummaryZh({
    repoName: project?.repoName ?? "",
    repoDescriptionRaw: project?.repoDescriptionRaw,
    readmeExcerptRaw: project?.readmeExcerptRaw,
    highlight: safeHighlight,
  });
}

function normalizeGitHubHighlight(
  highlight: string,
  project: ProjectRecord | undefined,
  fallbackTag: EventSummaryView["eventTag"],
) {
  if (looksLikeMalformedGitHubIntro(highlight)) {
    return buildGitHubProjectIntroZh(project ?? {}, fallbackTag);
  }

  return compactCopy(highlight);
}

function mapPerson(person: PersonRecord): PersonView {
  const sourceUrls = readStringArray(person.sourceUrlsJson);

  return {
    stableId: person.stableId,
    name: person.name,
    identitySummaryZh: person.identitySummaryZh,
    evidenceSummaryZh: person.evidenceSummaryZh,
    sourceUrls,
    githubUrl: person.githubUrl,
    scholarUrl: person.scholarUrl,
    linkedinUrl: person.linkedinUrl,
    xUrl: person.xUrl,
    homepageUrl: person.homepageUrl,
    email: person.email,
    organizationNamesRaw: readStringArray(person.organizationNamesRaw),
    schoolNamesRaw: readStringArray(person.schoolNamesRaw),
    labNamesRaw: readStringArray(person.labNamesRaw),
    bioSnippetsRaw: readStringArray(person.bioSnippetsRaw),
    founderHistoryRaw: readStringArray(person.founderHistoryRaw),
    links: buildPersonLinks({
      githubUrl: person.githubUrl,
      scholarUrl: person.scholarUrl,
      linkedinUrl: person.linkedinUrl,
      xUrl: person.xUrl,
      homepageUrl: person.homepageUrl,
      email: person.email,
      sourceUrls,
    }),
  };
}

function mapPersonPreview(person: PersonLinkRecord & Pick<PersonRecord, "stableId" | "name">): PersonPreviewView {
  const sourceUrls = readStringArray(person.sourceUrlsJson);

  return {
    stableId: person.stableId,
    name: person.name,
    primaryLinkUrl:
      buildPersonLinks({
        githubUrl: person.githubUrl,
        scholarUrl: person.scholarUrl,
        linkedinUrl: person.linkedinUrl,
        xUrl: person.xUrl,
        homepageUrl: person.homepageUrl,
        email: person.email,
        sourceUrls,
      })[0]?.url ?? null,
  };
}

function mapEventDetailPerson(link: ActiveEventRecord["personLinks"][number]) {
  return {
    ...mapPerson(link.person),
    contributionCount: link.contributionCount,
  };
}

function mapEventSummary(
  event: HomepageEventRecord,
  savedPeople: Set<string>,
): EventSummaryView {
  const projects = event.projectLinks.map((link) => link.project);
  const papers = event.paperLinks.map((link) => link.paper);
  const arxivNarrative = event.sourceType === "arxiv" ? buildArxivNarrative(event, papers[0]) : null;
  const safeHighlight =
    event.sourceType === "github"
      ? normalizeGitHubHighlight(event.eventHighlightZh, projects[0], event.eventTag as EventSummaryView["eventTag"])
      : event.eventHighlightZh;
  const cardSummary =
    event.sourceType === "github"
      ? getGitHubNarrativeSummary(event, projects[0], safeHighlight)
      : clampCopy(arxivNarrative?.lead ?? buildSourceSummary(event.sourceType, projects[0], papers[0], safeHighlight, CARD_SOURCE_SUMMARY_LIMIT), CARD_SOURCE_SUMMARY_LIMIT);
  const paperSummaryMetadata = event.sourceType === "arxiv" ? buildArxivSummaryMetadata(event, papers[0]) : null;

  return {
    stableId: event.stableId,
    sourceType: event.sourceType,
    eventType: event.eventType,
    eventTag: event.eventTag as EventSummaryView["eventTag"],
    eventTagConfidence: event.eventTagConfidence,
    eventTitleZh: event.eventTitleZh,
    eventHighlightZh: safeHighlight,
    eventDetailSummaryZh: event.eventDetailSummaryZh,
    timePrimary: event.timePrimary,
    metrics: normalizeHomepageMetrics(event.sourceType, parseMetrics(event.metricsJson), projects),
    sourceLinks: parseLinks(event.sourceLinksJson),
    peopleDetectionStatus: event.peopleDetectionStatus,
    projectStableIds: event.projectLinks.map((link) => link.project.stableId),
    paperStableIds: event.paperLinks.map((link) => link.paper.stableId),
    personStableIds: event.personLinks.map((link) => link.person.stableId),
    displayRank: event.displayRank,
    relatedRepoCount: event.relatedRepoCount,
    relatedPaperCount: event.relatedPaperCount,
    timeAgo: timeAgo(event.timePrimary),
    cardTitle: event.sourceType === "arxiv" ? papers[0]?.paperTitle ?? event.eventTitleZh : event.eventTitleZh,
    previewPeople: event.personLinks.slice(0, 3).map((link) => mapPersonPreview(link.person)),
    peopleCount: event.personLinks.length,
    isSaved: event.personLinks.some((link) => savedPeople.has(link.person.stableId)),
    cardSummary,
    paperSummaryMetadata,
  };
}

async function mapEventDetail(
  event: ActiveEventRecord,
): Promise<EventDetailView> {
  const projects = event.projectLinks.map((link) => link.project);
  const papers = event.paperLinks.map((link) => link.paper);
  const arxivNarrative = event.sourceType === "arxiv" ? buildArxivNarrative(event, papers[0]) : null;
  const arxivMetadata = event.sourceType === "arxiv" ? await buildArxivMetadata(event, papers[0], event.personLinks) : null;
  const safeHighlight =
    event.sourceType === "github"
      ? normalizeGitHubHighlight(event.eventHighlightZh, projects[0], event.eventTag as EventSummaryView["eventTag"])
      : event.eventHighlightZh;
  const detailSummary =
    event.sourceType === "arxiv"
      ? clampCopy(arxivNarrative?.lead ?? safeHighlight, DETAIL_SOURCE_SUMMARY_LIMIT)
      : buildSourceSummary(
          event.sourceType,
          projects[0],
          papers[0],
          safeHighlight,
          DETAIL_SOURCE_SUMMARY_LIMIT,
        );
  const cardSummary =
    event.sourceType === "github"
      ? getGitHubNarrativeSummary(event, projects[0], safeHighlight)
      : clampCopy(arxivNarrative?.lead ?? buildSourceSummary(event.sourceType, projects[0], papers[0], safeHighlight, CARD_SOURCE_SUMMARY_LIMIT), CARD_SOURCE_SUMMARY_LIMIT);

  return {
    stableId: event.stableId,
    people: event.personLinks.map((link) => mapEventDetailPerson(link)),
    sourceSummaryLabel: getSourceSummaryLabel(event.sourceType),
    detailSummary,
    introSummary:
      event.sourceType === "github"
        ? getGitHubNarrativeSummary(event, projects[0], safeHighlight) ||
          buildGitHubExpandedIntroZh({
            repoName: projects[0]?.repoName ?? event.eventTitleZh,
            repoDescriptionRaw: projects[0]?.repoDescriptionRaw,
            readmeExcerptRaw: projects[0]?.readmeExcerptRaw,
            highlight: safeHighlight,
            cardSummary,
          })
        : detailSummary,
    analysisSummary: null,
    analysisReferences: [],
    paperExplanation: event.sourceType === "arxiv" ? arxivNarrative : null,
    paperMetadata: event.sourceType === "arxiv" ? arxivMetadata : null,
  };
}

async function getBoardData(options?: { githubLimit?: number; arxivLimit?: number }) {
  const activeDataset = await ensureActiveDataset(prisma);
  const savedEntries = await prisma.pipelineEntry.findMany({
    select: { personStableId: true },
  });
  const savedPeople = new Set(savedEntries.map((entry) => entry.personStableId));

  const events = await prisma.event.findMany({
    where: {
      datasetVersionId: activeDataset.id,
    },
    include: {
      projectLinks: {
        include: {
          project: true,
        },
      },
      paperLinks: {
        include: {
          paper: true,
        },
      },
    personLinks: {
      orderBy: {
        position: "asc",
      },
      include: {
        person: {
          select: {
              stableId: true,
              name: true,
              githubUrl: true,
              scholarUrl: true,
              linkedinUrl: true,
              xUrl: true,
              homepageUrl: true,
              email: true,
              sourceUrlsJson: true,
            },
          },
        },
      },
    },
    orderBy: [{ sourceType: "asc" }, { displayRank: "asc" }],
  });

  const mappedEvents = events.map((event) => mapEventSummary(event, savedPeople));

  const githubEvents = mappedEvents
    .filter((event) => event.sourceType === "github")
    .sort((left, right) => extractTodayStars(right.metrics) - extractTodayStars(left.metrics))
    .slice(0, options?.githubLimit ?? HOMEPAGE_VISIBLE_LIMIT)
    .map((event, index) => ({
      ...event,
      displayRank: index + 1,
    }));
  const arxivEvents = mappedEvents
    .filter((event) => event.sourceType === "arxiv")
    .slice(0, options?.arxivLimit);

  return {
    datasetVersionId: activeDataset.id,
    savedPersonStableIds: [...savedPeople],
    githubEvents,
    arxivEvents,
  };
}

export async function getHomepageData() {
  return getBoardData({
    githubLimit: HOMEPAGE_VISIBLE_LIMIT,
    arxivLimit: HOMEPAGE_VISIBLE_LIMIT,
  });
}

export async function getArxivPageData() {
  return getBoardData({
    githubLimit: 0,
  });
}

export async function getPipelineData() {
  await ensureActiveDataset(prisma);

  const entries = await prisma.pipelineEntry.findMany({
    orderBy: { savedAt: "desc" },
  });

  const stableIds = entries.map((entry) => entry.personStableId);
  const people = await prisma.person.findMany({
    where: {
      stableId: { in: stableIds },
      datasetVersion: { status: "ACTIVE" },
    },
  });
  const peopleMap = new Map(people.map((person) => [person.stableId, mapPerson(person)]));

  const mappedEntries: PipelineEntryView[] = entries
    .map((entry) => {
      const person = peopleMap.get(entry.personStableId);

      if (!person) {
        return null;
      }

      const fallbackCopySummary = buildPersonCopySummary(person, entry.savedFromEventTitle, entry.recentActivitySummaryZh);

      return {
        personStableId: entry.personStableId,
        savedAt: entry.savedAt,
        savedFromEventStableId: entry.savedFromEventStableId,
        savedFromEventTitle: entry.savedFromEventTitle,
        recentActivitySummaryZh: entry.recentActivitySummaryZh,
        copySummaryShortZh: entry.copySummaryShortZh ?? fallbackCopySummary,
        copySummaryFullZh: entry.copySummaryFullZh ?? fallbackCopySummary,
        status: entry.status,
        lastContactedAt: entry.lastContactedAt,
        notes: entry.notes,
        person,
        timeAgo: timeAgo(entry.savedAt),
      };
    })
    .filter(Boolean) as PipelineEntryView[];

  return mappedEntries;
}

export async function getAdminData() {
  await ensureActiveDataset(prisma);

  return prisma.refreshRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 8,
  });
}

export async function getActiveEventByStableId(stableId: string) {
  const activeDataset = await ensureActiveDataset(prisma);

  return prisma.event.findFirst({
    where: {
      stableId,
      datasetVersionId: activeDataset.id,
    },
    include: {
      personLinks: { orderBy: { position: "asc" }, include: { person: true } },
      projectLinks: { include: { project: true } },
      paperLinks: { include: { paper: true } },
    },
  });
}

export async function getActiveEventDetailByStableId(stableId: string) {
  const event = await getActiveEventByStableId(stableId);
  return event ? await mapEventDetail(event) : null;
}

export async function getActiveEventAnalysisByStableId(stableId: string): Promise<EventAnalysisView | null> {
  const event = await getActiveEventByStableId(stableId);

  if (!event) {
    return null;
  }

  if (event.sourceType === "github") {
    const project = event.projectLinks[0]?.project;

    if (!project) {
      return null;
    }

    const detail = await mapEventDetail(event);
    const analysis = await generateGitHubProjectAnalysis({
      stableId: event.stableId,
      eventTitleZh: event.eventTitleZh,
      eventHighlightZh: event.eventHighlightZh,
      eventTag: event.eventTag,
      detailSummary: detail.detailSummary,
      metrics: parseMetrics(event.metricsJson),
      project: {
        repoName: project.repoName,
        ownerName: project.ownerName,
        repoDescriptionRaw: project.repoDescriptionRaw,
        readmeExcerptRaw: project.readmeExcerptRaw,
      },
      people: event.personLinks.map((link) => ({
        name: link.person.name,
        contributionCount: link.contributionCount,
        identitySummaryZh: link.person.identitySummaryZh,
      })),
    });

    return {
      stableId: event.stableId,
      analysisSummary: analysis.analysisSummary,
      analysisReferences: analysis.analysisReferences,
    };
  }

  if (event.sourceType === "arxiv") {
    const paper = event.paperLinks[0]?.paper;

    if (!paper) {
      return null;
    }

    const runtimeMetadata = await resolvePaperRuntimeMetadata({
      cacheKey: paper.stableId,
      paperUrl: paper.paperUrl,
      authors: readStringArray(paper.authorsJson),
      authorEmails: readStringArray(paper.authorEmailsRaw),
      institutionNames: readStringArray(paper.institutionNamesRaw),
      pdfTextRaw: paper.pdfTextRaw,
    });

    const analysis = await generatePaperAnalysis({
      stableId: event.stableId,
      eventTitleZh: event.eventTitleZh,
      eventHighlightZh: event.eventHighlightZh,
      eventTag: event.eventTag as EventSummaryView["eventTag"],
      relatedRepoCount: event.relatedRepoCount,
      paper: {
        paperTitle: paper.paperTitle,
        paperUrl: paper.paperUrl,
        authors: runtimeMetadata.authors,
        abstractRaw: paper.abstractRaw,
        pdfTextRaw: runtimeMetadata.pdfTextRaw,
        codeUrl: paper.codeUrl,
      },
    });

    return {
      stableId: event.stableId,
      analysisSummary: analysis.analysisSummary,
      analysisReferences: analysis.analysisReferences,
      paperExplanation: analysis.paperExplanation,
    };
  }

  return null;
}
