import { Prisma } from "@prisma/client";

import { buildPersonCopySummary } from "@/lib/copy";
import { prisma } from "@/lib/prisma";
import { ensureActiveDataset, parseLinks, parseMetrics } from "@/lib/seed";
import { timeAgo } from "@/lib/text";
import type { EventView, LinkItem, PersonView, PipelineEntryView } from "@/lib/types";

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
  codeUrl: string | null;
  relatedProjectIds: Prisma.JsonValue;
};

type PersonLinkRecord = Pick<
  PersonRecord,
  "githubUrl" | "scholarUrl" | "linkedinUrl" | "xUrl" | "homepageUrl" | "email" | "sourceUrlsJson"
>;

const CARD_SOURCE_SUMMARY_LIMIT = 220;
const DETAIL_SOURCE_SUMMARY_LIMIT = 560;

const PERSON_LINK_BUILDERS = [
  { label: "GitHub", getUrl: (person: PersonLinkRecord) => person.githubUrl },
  { label: "Scholar", getUrl: (person: PersonLinkRecord) => person.scholarUrl },
  { label: "LinkedIn", getUrl: (person: PersonLinkRecord) => person.linkedinUrl },
  { label: "X", getUrl: (person: PersonLinkRecord) => person.xUrl },
  { label: "Homepage", getUrl: (person: PersonLinkRecord) => person.homepageUrl },
  { label: "Email", getUrl: (person: PersonLinkRecord) => (person.email ? `mailto:${person.email}` : null) },
] as const;

function readStringList(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function normalizeHomepageMetrics(sourceType: "github" | "arxiv", metrics: Array<{ label: string; value: string }>) {
  if (sourceType !== "github") {
    return metrics;
  }

  return metrics.map((metric) => {
    if (metric.label !== "stars 增量") {
      return metric;
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
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
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

function getSourceSummaryLabel(sourceType: EventView["sourceType"]) {
  return sourceType === "github" ? "项目简介" : "论文简介";
}

function buildSourceSummary(
  sourceType: EventView["sourceType"],
  project: EventView["projects"][number] | undefined,
  paper: EventView["papers"][number] | undefined,
  fallback: string,
  limit: number,
) {
  const summary =
    sourceType === "github"
      ? uniqueCopyParts([project?.repoDescriptionRaw, project?.readmeExcerptRaw]).join(" ")
      : uniqueCopyParts([paper?.abstractRaw]).join(" ");

  return clampCopy(summary || fallback, limit);
}

function linksForPerson(person: PersonLinkRecord) {
  const directLinks: LinkItem[] = PERSON_LINK_BUILDERS.flatMap(({ label, getUrl }) => {
    const url = getUrl(person);
    return url ? [{ label, url }] : [];
  });

  if (directLinks.length > 0) {
    return directLinks;
  }

  return readStringList(person.sourceUrlsJson).map((url) => ({
    label: url.includes("github.com") ? "GitHub" : "外链",
    url,
  }));
}

function mapProject(project: ProjectRecord): EventView["projects"][number] {
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
    relatedPaperStableIds: readStringList(project.relatedPaperIdsJson),
  };
}

function mapPaper(paper: PaperRecord): EventView["papers"][number] {
  return {
    stableId: paper.stableId,
    paperTitle: paper.paperTitle,
    paperUrl: paper.paperUrl,
    authors: readStringList(paper.authorsJson),
    authorsCount: paper.authorsCount,
    publishedAt: paper.publishedAt,
    abstractRaw: paper.abstractRaw,
    codeUrl: paper.codeUrl,
    relatedProjectStableIds: readStringList(paper.relatedProjectIds),
  };
}

function mapPerson(person: PersonRecord): PersonView {
  return {
    stableId: person.stableId,
    name: person.name,
    identitySummaryZh: person.identitySummaryZh,
    evidenceSummaryZh: person.evidenceSummaryZh,
    sourceUrls: readStringList(person.sourceUrlsJson),
    githubUrl: person.githubUrl,
    scholarUrl: person.scholarUrl,
    linkedinUrl: person.linkedinUrl,
    xUrl: person.xUrl,
    homepageUrl: person.homepageUrl,
    email: person.email,
    organizationNamesRaw: readStringList(person.organizationNamesRaw),
    schoolNamesRaw: readStringList(person.schoolNamesRaw),
    labNamesRaw: readStringList(person.labNamesRaw),
    bioSnippetsRaw: readStringList(person.bioSnippetsRaw),
    founderHistoryRaw: readStringList(person.founderHistoryRaw),
    links: linksForPerson(person),
  };
}

export async function getHomepageData() {
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
        include: {
          person: true,
        },
      },
    },
    orderBy: [{ sourceType: "asc" }, { displayRank: "asc" }],
  });

  const mappedEvents: EventView[] = events.map((event) => {
    const projects = event.projectLinks.map((link) => mapProject(link.project));
    const papers = event.paperLinks.map((link) => mapPaper(link.paper));
    const detailSummary = buildSourceSummary(
      event.sourceType,
      projects[0],
      papers[0],
      event.eventHighlightZh,
      DETAIL_SOURCE_SUMMARY_LIMIT,
    );

    return {
      stableId: event.stableId,
      sourceType: event.sourceType,
      eventType: event.eventType,
      eventTag: event.eventTag as EventView["eventTag"],
      eventTagConfidence: event.eventTagConfidence,
      eventTitleZh: event.eventTitleZh,
      eventHighlightZh: event.eventHighlightZh,
      eventDetailSummaryZh: event.eventDetailSummaryZh,
      timePrimary: event.timePrimary,
      metrics: normalizeHomepageMetrics(event.sourceType, parseMetrics(event.metricsJson)),
      sourceLinks: parseLinks(event.sourceLinksJson),
      peopleDetectionStatus: event.peopleDetectionStatus,
      projectStableIds: event.projectLinks.map((link) => link.project.stableId),
      paperStableIds: event.paperLinks.map((link) => link.paper.stableId),
      personStableIds: event.personLinks.map((link) => link.person.stableId),
      displayRank: event.displayRank,
      relatedRepoCount: event.relatedRepoCount,
      relatedPaperCount: event.relatedPaperCount,
      timeAgo: timeAgo(event.timePrimary),
      projects,
      papers,
      people: event.personLinks.map((link) => mapPerson(link.person)),
      isSaved: event.personLinks.some((link) => savedPeople.has(link.person.stableId)),
      sourceSummaryLabel: getSourceSummaryLabel(event.sourceType),
      cardSummary: buildSourceSummary(event.sourceType, projects[0], papers[0], event.eventHighlightZh, CARD_SOURCE_SUMMARY_LIMIT),
      detailSummary,
      introSummary: event.sourceType === "arxiv" ? detailSummary : compactCopy(event.eventDetailSummaryZh) || detailSummary,
    };
  });

  const githubEvents = mappedEvents
    .filter((event) => event.sourceType === "github")
    .sort((left, right) => extractTodayStars(right.metrics) - extractTodayStars(left.metrics))
    .slice(0, 10)
    .map((event, index) => ({
      ...event,
      displayRank: index + 1,
    }));

  return {
    githubEvents,
    arxivEvents: mappedEvents.filter((event) => event.sourceType === "arxiv"),
  };
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
      personLinks: { include: { person: true } },
      projectLinks: { include: { project: true } },
      paperLinks: { include: { paper: true } },
    },
  });
}
