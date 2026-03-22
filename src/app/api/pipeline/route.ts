import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveEventByStableId } from "@/lib/data";
import { buildCopySummaries, buildRecentActivitySummary } from "@/lib/pipeline";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  personStableId: z.string().min(1),
  eventStableId: z.string().min(1),
});

export async function POST(request: Request) {
  const body = bodySchema.parse(await request.json());
  const event = await getActiveEventByStableId(body.eventStableId);

  if (!event) {
    return NextResponse.json({ error: "未找到对应事件" }, { status: 404 });
  }

  if (event.personLinks.length === 0) {
    return NextResponse.json({ error: "无人事件不能加入 Pipeline" }, { status: 400 });
  }

  const personLink = event.personLinks.find((link) => link.person.stableId === body.personStableId);

  if (!personLink) {
    return NextResponse.json({ error: "该人物不属于当前事件" }, { status: 400 });
  }

  const project = event.projectLinks[0]?.project;
  const paper = event.paperLinks[0]?.paper;
  const recentActivitySummaryZh = buildRecentActivitySummary({
    repoName: project?.repoName ?? null,
    starDelta7d: project?.starDelta7d ?? null,
    paperTitle: paper?.paperTitle ?? null,
    hasCode: Boolean(paper?.codeUrl),
  });
  const person = personLink.person;
  const links = [
    person.githubUrl ? { label: "GitHub", url: person.githubUrl } : null,
    person.scholarUrl ? { label: "Scholar", url: person.scholarUrl } : null,
    person.linkedinUrl ? { label: "LinkedIn", url: person.linkedinUrl } : null,
    person.xUrl ? { label: "X", url: person.xUrl } : null,
    person.homepageUrl ? { label: "Homepage", url: person.homepageUrl } : null,
  ].filter(Boolean) as Array<{ label: string; url: string }>;
  const personView = {
    stableId: person.stableId,
    name: person.name,
    identitySummaryZh: person.identitySummaryZh,
    evidenceSummaryZh: person.evidenceSummaryZh,
    sourceUrls: (person.sourceUrlsJson as string[]) ?? [],
    githubUrl: person.githubUrl,
    scholarUrl: person.scholarUrl,
    linkedinUrl: person.linkedinUrl,
    xUrl: person.xUrl,
    homepageUrl: person.homepageUrl,
    email: person.email,
    organizationNamesRaw: (person.organizationNamesRaw as string[]) ?? [],
    schoolNamesRaw: (person.schoolNamesRaw as string[]) ?? [],
    labNamesRaw: (person.labNamesRaw as string[]) ?? [],
    bioSnippetsRaw: (person.bioSnippetsRaw as string[]) ?? [],
    founderHistoryRaw: (person.founderHistoryRaw as string[]) ?? [],
    links,
  };
  const copySummaries = buildCopySummaries(personView, event.eventTitleZh, recentActivitySummaryZh);

  await prisma.pipelineEntry.upsert({
    where: { personStableId: body.personStableId },
    update: {
      savedAt: new Date(),
      savedFromEventStableId: body.eventStableId,
      savedFromEventTitle: event.eventTitleZh,
      recentActivitySummaryZh,
      copySummaryShortZh: copySummaries.short,
      copySummaryFullZh: copySummaries.full,
    },
    create: {
      id: `pipeline:${body.personStableId}`,
      personStableId: body.personStableId,
      savedAt: new Date(),
      savedFromEventStableId: body.eventStableId,
      savedFromEventTitle: event.eventTitleZh,
      recentActivitySummaryZh,
      copySummaryShortZh: copySummaries.short,
      copySummaryFullZh: copySummaries.full,
    },
  });

  return NextResponse.json({ ok: true, recentActivitySummaryZh });
}
