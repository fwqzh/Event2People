import { Prisma, PrismaClient } from "@prisma/client";

import { buildSampleDataset } from "@/lib/sample-data";
import type { DatasetBundleInput, LinkItem, MetricItem } from "@/lib/types";

type TxClient = Prisma.TransactionClient | PrismaClient;

function recordId(datasetVersionId: string, prefix: string, stableId: string) {
  return `${datasetVersionId}:${prefix}:${stableId}`;
}

async function clearExistingPipelineEntries(tx: TxClient) {
  await tx.pipelineEntry.deleteMany();
}

function getGitHubContributionCount(
  bundle: DatasetBundleInput,
  event: DatasetBundleInput["events"][number],
  personStableId: string,
) {
  if (event.sourceType !== "github") {
    return 0;
  }

  const project = bundle.projects.find((candidate) => candidate.stableId === event.projectStableIds[0]);

  if (!project) {
    return 0;
  }

  const contributor = (project.githubContributors ?? []).find(
    (candidate) => `github:${candidate.login.toLowerCase()}` === personStableId,
  );

  return contributor?.contributions ?? 0;
}

async function persistDataset(tx: TxClient, datasetVersionId: string, bundle: DatasetBundleInput) {
  await tx.project.createMany({
    data: bundle.projects.map((project) => ({
      id: recordId(datasetVersionId, "project", project.stableId),
      stableId: project.stableId,
      datasetVersionId,
      repoName: project.repoName,
      repoUrl: project.repoUrl,
      ownerName: project.ownerName,
      ownerUrl: project.ownerUrl,
      stars: project.stars,
      starDelta7d: project.starDelta7d,
      contributorsCount: project.contributorsCount,
      repoCreatedAt: project.repoCreatedAt,
      repoUpdatedAt: project.repoUpdatedAt,
      repoDescriptionRaw: project.repoDescriptionRaw ?? null,
      readmeExcerptRaw: project.readmeExcerptRaw ?? null,
      relatedPaperIdsJson: project.relatedPaperStableIds ?? Prisma.JsonNull,
    })),
  });

  await tx.projectSnapshot.createMany({
    data: bundle.projects.map((project) => ({
      id: recordId(datasetVersionId, "snapshot", project.stableId),
      datasetVersionId,
      projectId: recordId(datasetVersionId, "project", project.stableId),
      capturedAt: new Date(),
      stars: project.stars,
      starDelta7d: project.starDelta7d,
    })),
  });

  await tx.paper.createMany({
    data: bundle.papers.map((paper) => ({
      id: recordId(datasetVersionId, "paper", paper.stableId),
      stableId: paper.stableId,
      datasetVersionId,
      paperTitle: paper.paperTitle,
      paperUrl: paper.paperUrl,
      authorsJson: paper.authors,
      authorsCount: paper.authorsCount,
      publishedAt: paper.publishedAt,
      abstractRaw: paper.abstractRaw ?? null,
      codeUrl: paper.codeUrl ?? null,
      relatedProjectIds: paper.relatedProjectStableIds ?? Prisma.JsonNull,
    })),
  });

  await tx.person.createMany({
    data: bundle.people.map((person) => ({
      id: recordId(datasetVersionId, "person", person.stableId),
      stableId: person.stableId,
      datasetVersionId,
      name: person.name,
      identitySummaryZh: person.identitySummaryZh,
      evidenceSummaryZh: person.evidenceSummaryZh,
      sourceUrlsJson: person.sourceUrls,
      githubUrl: person.githubUrl ?? null,
      scholarUrl: person.scholarUrl ?? null,
      linkedinUrl: person.linkedinUrl ?? null,
      xUrl: person.xUrl ?? null,
      homepageUrl: person.homepageUrl ?? null,
      email: person.email ?? null,
      organizationNamesRaw: person.organizationNamesRaw ?? Prisma.JsonNull,
      schoolNamesRaw: person.schoolNamesRaw ?? Prisma.JsonNull,
      labNamesRaw: person.labNamesRaw ?? Prisma.JsonNull,
      bioSnippetsRaw: person.bioSnippetsRaw ?? Prisma.JsonNull,
      founderHistoryRaw: person.founderHistoryRaw ?? Prisma.JsonNull,
    })),
  });

  await tx.repoPaperLink.createMany({
    data: bundle.repoPaperLinks.map((link, index) => ({
      id: recordId(datasetVersionId, `repo-paper-${index}`, `${link.projectStableId}:${link.paperStableId}`),
      datasetVersionId,
      projectId: recordId(datasetVersionId, "project", link.projectStableId),
      paperId: recordId(datasetVersionId, "paper", link.paperStableId),
      evidenceType: link.evidenceType,
      evidenceSourceUrl: link.evidenceSourceUrl,
      evidenceExcerpt: link.evidenceExcerpt,
      confidence: link.confidence,
    })),
  });

  await tx.event.createMany({
    data: bundle.events.map((event) => ({
      id: recordId(datasetVersionId, "event", event.stableId),
      stableId: event.stableId,
      datasetVersionId,
      sourceType: event.sourceType,
      eventType: event.eventType,
      eventTag: event.eventTag,
      eventTagConfidence: event.eventTagConfidence,
      eventTitleZh: event.eventTitleZh,
      eventHighlightZh: event.eventHighlightZh,
      eventDetailSummaryZh: event.eventDetailSummaryZh ?? null,
      timePrimary: event.timePrimary,
      metricsJson: event.metrics,
      sourceLinksJson: event.sourceLinks,
      peopleDetectionStatus: event.peopleDetectionStatus,
      displayRank: event.displayRank,
      relatedRepoCount: event.relatedRepoCount ?? null,
      relatedPaperCount: event.relatedPaperCount ?? null,
    })),
  });

  await tx.eventProject.createMany({
    data: bundle.events.flatMap((event) =>
      event.projectStableIds.map((projectStableId) => ({
        eventId: recordId(datasetVersionId, "event", event.stableId),
        projectId: recordId(datasetVersionId, "project", projectStableId),
      })),
    ),
  });

  await tx.eventPaper.createMany({
    data: bundle.events.flatMap((event) =>
      event.paperStableIds.map((paperStableId) => ({
        eventId: recordId(datasetVersionId, "event", event.stableId),
        paperId: recordId(datasetVersionId, "paper", paperStableId),
      })),
    ),
  });

  await tx.eventPerson.createMany({
    data: bundle.events.flatMap((event) =>
      event.personStableIds.map((personStableId, index) => ({
        eventId: recordId(datasetVersionId, "event", event.stableId),
        personId: recordId(datasetVersionId, "person", personStableId),
        position: index,
        contributionCount: getGitHubContributionCount(bundle, event, personStableId),
      })),
    ),
  });

  await clearExistingPipelineEntries(tx);

  if (bundle.pipelineEntries?.length) {
    await tx.pipelineEntry.createMany({
      data: bundle.pipelineEntries.map((entry) => ({
        id: `pipeline:${entry.personStableId}`,
        personStableId: entry.personStableId,
        savedAt: entry.savedAt,
        savedFromEventStableId: entry.savedFromEventStableId,
        savedFromEventTitle: entry.savedFromEventTitle,
        recentActivitySummaryZh: entry.recentActivitySummaryZh,
        copySummaryShortZh: entry.copySummaryShortZh ?? null,
        copySummaryFullZh: entry.copySummaryFullZh ?? null,
        status: entry.status ?? null,
        lastContactedAt: entry.lastContactedAt ?? null,
        notes: entry.notes ?? null,
      })),
    });
  }
}

export async function seedSampleData(prisma: PrismaClient, source = "sample-seed") {
  const activeVersion = await prisma.datasetVersion.findFirst({
    where: { status: "ACTIVE" },
  });

  if (activeVersion) {
    return activeVersion;
  }

  const datasetVersionId = `dataset-${Date.now()}`;
  const bundle = buildSampleDataset();

  await prisma.$transaction(async (tx) => {
    await tx.datasetVersion.create({
      data: {
        id: datasetVersionId,
        label: bundle.label,
        source,
        status: "DRAFT",
      },
    });

    await persistDataset(tx, datasetVersionId, bundle);

    await tx.datasetVersion.update({
      where: { id: datasetVersionId },
      data: {
        status: "ACTIVE",
        publishedAt: new Date(),
      },
    });
  });

  return prisma.datasetVersion.findUniqueOrThrow({
    where: { id: datasetVersionId },
  });
}

export async function ensureActiveDataset(prisma: PrismaClient) {
  const activeVersion = await prisma.datasetVersion.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { publishedAt: "desc" },
  });

  if (activeVersion) {
    return activeVersion;
  }

  return seedSampleData(prisma);
}

export function parseMetrics(value: Prisma.JsonValue) {
  return (value as MetricItem[]) ?? [];
}

export function parseLinks(value: Prisma.JsonValue) {
  return (value as LinkItem[]) ?? [];
}

export { persistDataset, recordId };
