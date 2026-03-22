import { Prisma } from "@prisma/client";

import { buildPersonCopySummary } from "@/lib/copy";
import {
  buildGitHubCardSummaryZh,
  buildGitHubExpandedIntroZh,
  buildGitHubProjectIntroZh,
  looksLikeMalformedGitHubIntro,
} from "@/lib/github-copy";
import { prisma } from "@/lib/prisma";
import { ensureActiveDataset, parseLinks, parseMetrics } from "@/lib/seed";
import { clampPlainText, timeAgo } from "@/lib/text";
import type { EventDetailView, EventSummaryView, LinkItem, PersonPreviewView, PersonView, PipelineEntryView } from "@/lib/types";

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
const countFormatter = new Intl.NumberFormat("en-US");

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

function normalizeHomepageMetrics(
  sourceType: "github" | "arxiv",
  metrics: Array<{ label: string; value: string }>,
  projects: ProjectRecord[] = [],
) {
  if (sourceType !== "github") {
    return metrics;
  }

  const totalStars = projects.reduce((sum, project) => sum + project.stars, 0);

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

      return {
        label: "Total Stars",
        value: totalStars > 0 ? countFormatter.format(totalStars) : metric.value,
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
  return sourceType === "github" ? "项目简介" : "论文简介";
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
      : uniqueCopyParts([paper?.abstractRaw]).join(" ");

  return clampCopy(summary || fallback, limit);
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

function mapPersonPreview(person: PersonLinkRecord & Pick<PersonRecord, "stableId" | "name">): PersonPreviewView {
  return {
    stableId: person.stableId,
    name: person.name,
    primaryLinkUrl: linksForPerson(person)[0]?.url ?? null,
  };
}

function mapEventSummary(
  event: HomepageEventRecord,
  savedPeople: Set<string>,
): EventSummaryView {
  const projects = event.projectLinks.map((link) => link.project);
  const papers = event.paperLinks.map((link) => link.paper);
  const safeHighlight =
    event.sourceType === "github"
      ? normalizeGitHubHighlight(event.eventHighlightZh, projects[0], event.eventTag as EventSummaryView["eventTag"])
      : event.eventHighlightZh;
  const cardSummary =
    event.sourceType === "github"
      ? buildGitHubCardSummaryZh({
          repoName: projects[0]?.repoName ?? event.eventTitleZh,
          repoDescriptionRaw: projects[0]?.repoDescriptionRaw,
          readmeExcerptRaw: projects[0]?.readmeExcerptRaw,
          highlight: safeHighlight,
        })
      : buildSourceSummary(event.sourceType, projects[0], papers[0], safeHighlight, CARD_SOURCE_SUMMARY_LIMIT);

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
  };
}

function mapEventDetail(
  event: ActiveEventRecord,
): EventDetailView {
  const projects = event.projectLinks.map((link) => link.project);
  const papers = event.paperLinks.map((link) => link.paper);
  const safeHighlight =
    event.sourceType === "github"
      ? normalizeGitHubHighlight(event.eventHighlightZh, projects[0], event.eventTag as EventSummaryView["eventTag"])
      : event.eventHighlightZh;
  const detailSummary = buildSourceSummary(
    event.sourceType,
    projects[0],
    papers[0],
    safeHighlight,
    DETAIL_SOURCE_SUMMARY_LIMIT,
  );
  const cardSummary =
    event.sourceType === "github"
      ? buildGitHubCardSummaryZh({
          repoName: projects[0]?.repoName ?? event.eventTitleZh,
          repoDescriptionRaw: projects[0]?.repoDescriptionRaw,
          readmeExcerptRaw: projects[0]?.readmeExcerptRaw,
          highlight: safeHighlight,
        })
      : buildSourceSummary(event.sourceType, projects[0], papers[0], safeHighlight, CARD_SOURCE_SUMMARY_LIMIT);

  return {
    stableId: event.stableId,
    people: event.personLinks.map((link) => mapPerson(link.person)),
    sourceSummaryLabel: getSourceSummaryLabel(event.sourceType),
    detailSummary,
    introSummary:
      event.sourceType === "github"
        ? buildGitHubExpandedIntroZh({
            repoName: projects[0]?.repoName ?? event.eventTitleZh,
            repoDescriptionRaw: projects[0]?.repoDescriptionRaw,
            readmeExcerptRaw: projects[0]?.readmeExcerptRaw,
            highlight: safeHighlight,
            cardSummary,
          })
        : detailSummary,
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
    .slice(0, 10)
    .map((event, index) => ({
      ...event,
      displayRank: index + 1,
    }));

  return {
    datasetVersionId: activeDataset.id,
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

export async function getActiveEventDetailByStableId(stableId: string) {
  const event = await getActiveEventByStableId(stableId);
  return event ? mapEventDetail(event) : null;
}
