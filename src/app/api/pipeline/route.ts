import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveEventByStableId } from "@/lib/data";
import { readStringArray } from "@/lib/json";
import { buildCopySummaries, buildRecentActivitySummary } from "@/lib/pipeline";
import { buildPersonLinks } from "@/lib/person-links";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  personStableId: z.string().min(1),
  eventStableId: z.string().min(1),
});

const deleteBodySchema = z.object({
  personStableId: z.string().min(1),
});

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function internalServerError(error: unknown) {
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : "Pipeline 操作失败",
    },
    { status: 500 },
  );
}

async function parseRequestBody<T>(request: Request, schema: z.ZodType<T>) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return {
      ok: false as const,
      response: badRequest("请求体必须是合法 JSON"),
    };
  }

  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    return {
      ok: false as const,
      response: badRequest("请求参数无效"),
    };
  }

  return {
    ok: true as const,
    data: parsed.data,
  };
}

export async function GET() {
  try {
    const entries = await prisma.pipelineEntry.findMany({
      orderBy: { savedAt: "desc" },
      select: { personStableId: true },
    });

    return NextResponse.json({
      ok: true,
      savedPersonStableIds: entries.map((entry) => entry.personStableId),
    });
  } catch (error) {
    return internalServerError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsedBody = await parseRequestBody(request, bodySchema);

    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const body = parsedBody.data;
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
    const sourceUrls = readStringArray(person.sourceUrlsJson);
    const personView = {
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
  } catch (error) {
    return internalServerError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const parsedBody = await parseRequestBody(request, deleteBodySchema);

    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    await prisma.pipelineEntry.deleteMany({
      where: { personStableId: parsedBody.data.personStableId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return internalServerError(error);
  }
}
