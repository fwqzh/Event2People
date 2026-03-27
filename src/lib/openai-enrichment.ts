import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { env, hasOpenAiKey } from "@/lib/env";
import { looksLikeMalformedGitHubIntro } from "@/lib/github-copy";
import { clampZh, repoDisplayName, sentenceZh } from "@/lib/text";
import type { DatasetBundleInput, EventInput, PersonInput } from "@/lib/types";

const EVENT_TITLE_LIMIT = 32;
const EVENT_HIGHLIGHT_LIMIT = 20;
const EVENT_DETAIL_LIMIT = 64;
const IDENTITY_LIMIT = 36;
const EVIDENCE_LIMIT = 36;
const EVENT_BATCH_SIZE = 4;
const PERSON_BATCH_SIZE = 6;
const AI_REQUEST_TIMEOUT_MS = 60_000;

const EventBatchSchema = z.object({
  items: z.array(
    z.object({
      stableId: z.string(),
      eventTitleZh: z.string().min(1),
      eventHighlightZh: z.string().min(1),
      eventDetailSummaryZh: z.string().nullable().optional(),
    }),
  ),
});

const PersonBatchSchema = z.object({
  items: z.array(
    z.object({
      stableId: z.string(),
      identitySummaryZh: z.string().min(1),
      evidenceSummaryZh: z.string().min(1),
    }),
  ),
});

type EventBatchOutput = z.infer<typeof EventBatchSchema>;
type PersonBatchOutput = z.infer<typeof PersonBatchSchema>;

export type AiEnrichmentResult = {
  bundle: DatasetBundleInput;
  enabled: boolean;
  model: string | null;
  eventCount: number;
  personCount: number;
  errors: string[];
};

type AiEnrichmentProgress = {
  phase: "events" | "people";
  completedBatches: number;
  totalBatches: number;
  completedItems: number;
  totalItems: number;
};

let clientSingleton: OpenAI | null | undefined;

function usesCompatibleChatApi() {
  return Boolean(env.openAiBaseUrl);
}

function getClient() {
  if (!hasOpenAiKey) {
    return null;
  }

  if (!clientSingleton) {
    clientSingleton = new OpenAI({
      apiKey: env.openAiApiKey,
      ...(env.openAiBaseUrl ? { baseURL: env.openAiBaseUrl } : {}),
      timeout: AI_REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });
  }

  return clientSingleton;
}

function contentToString(
  content:
    | string
    | Array<{
        type?: string;
        text?: string;
      }>
    | null
    | undefined,
) {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => ("text" in part ? part.text ?? "" : ""))
    .join("")
    .trim();
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function trimForModel(value: string | null | undefined, limit = 280) {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function pickNonEmpty(value: string | null | undefined, fallback: string) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned : fallback;
}

function normalizeIdentitySummaryZh(value: string | null | undefined, fallback: string) {
  const cleaned = pickNonEmpty(value, fallback).replace(/[•|｜]/g, "·");
  const segments = cleaned
    .split("·")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 2);

  return clampZh((segments.length > 0 ? segments.join(" · ") : cleaned).replace(/\s+/g, " ").trim(), IDENTITY_LIMIT);
}

function normalizeEvidenceSummaryZh(value: string | null | undefined, fallback: string) {
  const cleaned = pickNonEmpty(value, fallback).replace(/[;；]+/g, "；");
  const clauses = cleaned
    .split("；")
    .map((clause) => clause.trim())
    .filter(Boolean)
    .slice(0, 2);

  return clampZh((clauses.length > 0 ? clauses.join("；") : cleaned).replace(/\s+/g, " ").trim(), EVIDENCE_LIMIT);
}

function normalizeEventBatch(events: EventInput[], output: EventBatchOutput) {
  const outputByStableId = new Map(output.items.map((item) => [item.stableId, item]));
  let enrichedCount = 0;

  const normalizedEvents = events.map((event) => {
    const generated = outputByStableId.get(event.stableId);

    if (!generated) {
      return event;
    }

    const normalizedHighlightCandidate = pickNonEmpty(generated.eventHighlightZh, event.eventHighlightZh);
    const safeHighlight =
      event.sourceType === "github" && looksLikeMalformedGitHubIntro(normalizedHighlightCandidate)
        ? event.eventHighlightZh
        : normalizedHighlightCandidate;

    const nextEvent: EventInput = {
      ...event,
      eventTitleZh: clampZh(pickNonEmpty(generated.eventTitleZh, event.eventTitleZh), EVENT_TITLE_LIMIT),
      eventHighlightZh: sentenceZh(safeHighlight, EVENT_HIGHLIGHT_LIMIT),
      eventDetailSummaryZh: clampZh(
        pickNonEmpty(generated.eventDetailSummaryZh ?? event.eventDetailSummaryZh ?? "", event.eventDetailSummaryZh ?? ""),
        EVENT_DETAIL_LIMIT,
      ),
    };

    if (
      nextEvent.eventTitleZh !== event.eventTitleZh ||
      nextEvent.eventHighlightZh !== event.eventHighlightZh ||
      nextEvent.eventDetailSummaryZh !== event.eventDetailSummaryZh
    ) {
      enrichedCount += 1;
    }

    return nextEvent;
  });

  return { events: normalizedEvents, enrichedCount };
}

function normalizePersonBatch(people: PersonInput[], output: PersonBatchOutput) {
  const outputByStableId = new Map(output.items.map((item) => [item.stableId, item]));
  let enrichedCount = 0;

  const normalizedPeople = people.map((person) => {
    const generated = outputByStableId.get(person.stableId);

    if (!generated) {
      return person;
    }

    const nextPerson: PersonInput = {
      ...person,
      identitySummaryZh: normalizeIdentitySummaryZh(generated.identitySummaryZh, person.identitySummaryZh),
      evidenceSummaryZh: normalizeEvidenceSummaryZh(generated.evidenceSummaryZh, person.evidenceSummaryZh),
    };

    if (
      nextPerson.identitySummaryZh !== person.identitySummaryZh ||
      nextPerson.evidenceSummaryZh !== person.evidenceSummaryZh
    ) {
      enrichedCount += 1;
    }

    return nextPerson;
  });

  return { people: normalizedPeople, enrichedCount };
}

function extractJsonPayload(raw: string) {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  if (!withoutThink) {
    throw new Error("empty model response");
  }

  const fencedMatch = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = withoutThink.indexOf("{");
  const end = withoutThink.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return withoutThink.slice(start, end + 1);
  }

  return withoutThink;
}

function parseCompatibleJson<T>(raw: string, schema: z.ZodSchema<T>) {
  const payload = extractJsonPayload(raw);
  return schema.parse(JSON.parse(payload));
}

function buildEventFacts(events: EventInput[], bundle: DatasetBundleInput) {
  const projectMap = new Map(bundle.projects.map((project) => [project.stableId, project]));
  const paperMap = new Map(bundle.papers.map((paper) => [paper.stableId, paper]));
  const personMap = new Map(bundle.people.map((person) => [person.stableId, person]));

  return events.map((event) => ({
    stableId: event.stableId,
    sourceType: event.sourceType,
    eventType: event.eventType,
    eventTag: event.eventTag,
    draft: {
      eventTitleZh: event.eventTitleZh,
      eventHighlightZh: event.eventHighlightZh,
      eventDetailSummaryZh: event.eventDetailSummaryZh ?? "",
    },
    metrics: event.metrics,
    projects: event.projectStableIds
      .map((stableId) => projectMap.get(stableId))
      .filter(Boolean)
      .map((project) => ({
        repoName: project!.repoName,
        repoDisplayName: repoDisplayName(project!.repoName),
        ownerName: project!.ownerName,
        todayStars: project!.todayStars ?? null,
        stars: project!.stars,
        starDelta7d: project!.starDelta7d,
        contributorsCount: project!.contributorsCount,
        repoDescriptionRaw: trimForModel(project!.repoDescriptionRaw),
        readmeExcerptRaw: trimForModel(project!.readmeExcerptRaw),
        marketContextSnippetsRaw: (project!.marketContextSnippetsRaw ?? []).map((snippet) => trimForModel(snippet, 180)),
        marketContextLinks: (project!.marketContextLinks ?? []).slice(0, 3),
      })),
    papers: event.paperStableIds
      .map((stableId) => paperMap.get(stableId))
      .filter(Boolean)
      .map((paper) => ({
        paperTitle: paper!.paperTitle,
        authors: paper!.authors,
        authorsCount: paper!.authorsCount,
        hasCode: Boolean(paper!.codeUrl),
        abstractRaw: trimForModel(paper!.pdfTextRaw ?? paper!.abstractRaw, 1200),
      })),
    people: event.personStableIds
      .map((stableId) => personMap.get(stableId))
      .filter(Boolean)
      .map((person) => ({
        name: person!.name,
        identitySummaryZh: person!.identitySummaryZh,
      })),
    sourceLinks: event.sourceLinks,
  }));
}

function buildPersonFacts(people: PersonInput[], bundle: DatasetBundleInput) {
  const relatedEventsByPerson = new Map<string, EventInput[]>();
  const projectMap = new Map(bundle.projects.map((project) => [project.stableId, project]));
  const paperMap = new Map(bundle.papers.map((paper) => [paper.stableId, paper]));

  for (const event of bundle.events) {
    for (const personStableId of event.personStableIds) {
      const current = relatedEventsByPerson.get(personStableId) ?? [];
      current.push(event);
      relatedEventsByPerson.set(personStableId, current);
    }
  }

  return people.map((person) => {
    const relatedEvents = relatedEventsByPerson.get(person.stableId) ?? [];
    const relatedProjects = relatedEvents.flatMap((event) => event.projectStableIds).map((stableId) => projectMap.get(stableId)).filter(Boolean);
    const relatedPapers = relatedEvents.flatMap((event) => event.paperStableIds).map((stableId) => paperMap.get(stableId)).filter(Boolean);

    return {
      stableId: person.stableId,
      name: person.name,
      draft: {
        identitySummaryZh: person.identitySummaryZh,
        evidenceSummaryZh: person.evidenceSummaryZh,
      },
      links: {
        githubUrl: person.githubUrl ?? "",
        scholarUrl: person.scholarUrl ?? "",
        linkedinUrl: person.linkedinUrl ?? "",
        xUrl: person.xUrl ?? "",
        homepageUrl: person.homepageUrl ?? "",
        email: person.email ?? "",
      },
      organizations: person.organizationNamesRaw ?? [],
      schools: person.schoolNamesRaw ?? [],
      labs: person.labNamesRaw ?? [],
      bioSnippets: (person.bioSnippetsRaw ?? []).map((snippet) => trimForModel(snippet, 180)),
      founderHistory: (person.founderHistoryRaw ?? []).map((snippet) => trimForModel(snippet, 180)),
      relatedEvents: relatedEvents.map((event) => ({
        eventType: event.eventType,
        eventTag: event.eventTag,
        eventTitleZh: event.eventTitleZh,
      })),
      relatedProjects: relatedProjects.map((project) => ({
        repoName: project!.repoName,
        ownerName: project!.ownerName,
        starDelta7d: project!.starDelta7d,
      })),
      relatedPapers: relatedPapers.map((paper) => ({
        paperTitle: paper!.paperTitle,
        authorsCount: paper!.authorsCount,
        hasCode: Boolean(paper!.codeUrl),
      })),
    };
  });
}

async function enrichEventBatch(client: OpenAI, events: EventInput[], bundle: DatasetBundleInput) {
  if (events.length === 0) {
    return { events, enrichedCount: 0 };
  }

  if (usesCompatibleChatApi()) {
    const completion = await client.chat.completions.create(
      {
        model: env.openAiModel,
        temperature: 0.3,
        max_completion_tokens: 1400,
        messages: [
          {
            role: "system",
            content: [
              "你是 Frontier Event-to-People 产品的后台中文编辑器。",
              "只基于给定结构化事实生成克制、准确、可追溯的简体中文短文案。",
              "不要发明事实，不要做趋势判断，不要加入空泛评价，不要改写专有名词原文。",
              `如果 sourceType 是 github，eventTitleZh 必须直接写主项目名，优先使用 repoDisplayName，不要写“stars 增长”或“获得实现”这类事件句，最长 ${EVENT_TITLE_LIMIT} 个中文字符。`,
              `如果 sourceType 是 github，eventHighlightZh 必须用一句中文概括这个项目做什么，而不是为什么值得看，最长 ${EVENT_HIGHLIGHT_LIMIT} 个中文字符。`,
              "如果给了 marketContextSnippetsRaw，优先综合这些中文互联网说明与 repo 原始描述，写成让首次看到该项目的投资人或产品负责人也能立刻知道它是什么的表述。",
              "GitHub 的 eventDetailSummaryZh 需要进一步解释项目类别、核心工作流或它在链路里扮演的角色，不要写 stars、热度、值得关注、形成信号之类判断。",
              `如果 sourceType 是 arxiv，eventTitleZh 保持事件句写法，最长 ${EVENT_TITLE_LIMIT} 个中文字符。`,
              `如果 sourceType 是 arxiv，eventHighlightZh 必须只有一句，概括研究入口或实现关系，最长 ${EVENT_HIGHLIGHT_LIMIT} 个中文字符。`,
              `eventDetailSummaryZh 最长 ${EVENT_DETAIL_LIMIT} 个中文字符。`,
              '只返回 JSON，格式必须是 {"items":[...]}，不要使用 Markdown 代码块，不要输出额外说明。',
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                task: "为 events 生成中文展示字段",
                items: buildEventFacts(events, bundle),
              },
              null,
              2,
            ),
          },
        ],
      },
      {
        timeout: AI_REQUEST_TIMEOUT_MS,
        maxRetries: 1,
      },
    );

    const raw = contentToString(completion.choices[0]?.message?.content);
    return normalizeEventBatch(events, parseCompatibleJson(raw, EventBatchSchema));
  }

  const response = await client.responses.parse(
    {
      model: env.openAiModel,
      instructions: [
        "你是 Frontier Event-to-People 产品的后台中文编辑器。",
        "你的任务是只基于给定结构化事实，生成克制、准确、可追溯的简体中文短文案。",
        "不要发明事实，不要加入趋势判断，不要输出空泛评价，不要改变专有名词原文。",
        `如果 sourceType 是 github，eventTitleZh 必须直接写主项目名，优先使用 repoDisplayName，不要写“stars 增长”或“获得实现”这类事件句，最长 ${EVENT_TITLE_LIMIT} 个中文字符。`,
        `如果 sourceType 是 github，eventHighlightZh 必须用一句中文概括这个项目做什么，而不是为什么值得看，最长 ${EVENT_HIGHLIGHT_LIMIT} 个中文字符。`,
        "如果给了 marketContextSnippetsRaw，优先综合这些中文互联网说明与 repo 原始描述，写成让首次看到该项目的投资人或产品负责人也能立刻知道它是什么的表述。",
        "GitHub 的 eventDetailSummaryZh 需要进一步解释项目类别、核心工作流或它在链路里扮演的角色，不要写 stars、热度、值得关注、形成信号之类判断。",
        `如果 sourceType 是 arxiv，eventTitleZh 保持事件句写法，最长 ${EVENT_TITLE_LIMIT} 个中文字符。`,
        `如果 sourceType 是 arxiv，eventHighlightZh 必须只有一句，概括研究入口或实现关系，最长 ${EVENT_HIGHLIGHT_LIMIT} 个中文字符。`,
        `eventDetailSummaryZh 最长 ${EVENT_DETAIL_LIMIT} 个中文字符。`,
        "如果事实不足，就尽量贴近 draft 文案，不要编造。",
      ].join("\n"),
      input: JSON.stringify(
        {
          task: "为 events 生成中文展示字段",
          items: buildEventFacts(events, bundle),
        },
        null,
        2,
      ),
      text: {
        format: zodTextFormat(EventBatchSchema, "event_enrichment"),
      },
    },
    {
      timeout: AI_REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    },
  );

  return normalizeEventBatch(events, response.output_parsed ?? { items: [] });
}

async function enrichPersonBatch(client: OpenAI, people: PersonInput[], bundle: DatasetBundleInput) {
  if (people.length === 0) {
    return { people, enrichedCount: 0 };
  }

  if (usesCompatibleChatApi()) {
    const completion = await client.chat.completions.create(
      {
        model: env.openAiModel,
        temperature: 0.3,
        max_completion_tokens: 1400,
        messages: [
          {
            role: "system",
            content: [
              "你是 Frontier Event-to-People 产品的后台中文编辑器。",
              "只基于给定结构化事实，生成人物身份摘要和证据摘要。",
              "不要发明事实，不要主观评价，不要写值得联系、潜力大之类判断。",
              `identitySummaryZh 使用“当前最强身份 · 次强背景”风格，最长 ${IDENTITY_LIMIT} 个中文字符，最多两段。`,
              `evidenceSummaryZh 必须是事实短句，最多两条证据，用中文分号分隔，最长 ${EVIDENCE_LIMIT} 个中文字符。`,
              '只返回 JSON，格式必须是 {"items":[...]}，不要使用 Markdown 代码块，不要输出额外说明。',
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                task: "为 people 生成人物中文摘要",
                items: buildPersonFacts(people, bundle),
              },
              null,
              2,
            ),
          },
        ],
      },
      {
        timeout: AI_REQUEST_TIMEOUT_MS,
        maxRetries: 1,
      },
    );

    const raw = contentToString(completion.choices[0]?.message?.content);
    return normalizePersonBatch(people, parseCompatibleJson(raw, PersonBatchSchema));
  }

  const response = await client.responses.parse(
    {
      model: env.openAiModel,
      instructions: [
        "你是 Frontier Event-to-People 产品的后台中文编辑器。",
        "你的任务是只基于给定结构化事实，生成简体中文的人物身份摘要和证据摘要。",
        "不要发明事实，不要主观评价，不要写值得联系、潜力大之类判断。",
        `identitySummaryZh 使用“当前最强身份 · 次强背景”风格，最长 ${IDENTITY_LIMIT} 个中文字符，最多两段。`,
        `evidenceSummaryZh 必须是事实短句，最多两条证据，用中文分号分隔，最长 ${EVIDENCE_LIMIT} 个中文字符。`,
        "专有名词保持原文。如果事实不足，就贴近 draft 文案。",
      ].join("\n"),
      input: JSON.stringify(
        {
          task: "为 people 生成人物中文摘要",
          items: buildPersonFacts(people, bundle),
        },
        null,
        2,
      ),
      text: {
        format: zodTextFormat(PersonBatchSchema, "person_enrichment"),
      },
    },
    {
      timeout: AI_REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    },
  );

  return normalizePersonBatch(people, response.output_parsed ?? { items: [] });
}

export async function enrichBundleWithOpenAI(
  bundle: DatasetBundleInput,
  options?: {
    enrichPeople?: boolean;
    onProgress?: (progress: AiEnrichmentProgress) => void | Promise<void>;
  },
): Promise<AiEnrichmentResult> {
  const client = getClient();

  if (!client) {
    return {
      bundle,
      enabled: false,
      model: null,
      eventCount: 0,
      personCount: 0,
      errors: [],
    };
  }

  const errors: string[] = [];
  let events = bundle.events;
  let people = bundle.people;
  let eventCount = 0;
  let personCount = 0;
  const eventBatches = chunk(events, EVENT_BATCH_SIZE);
  const personBatches = options?.enrichPeople === false ? [] : chunk(people, PERSON_BATCH_SIZE);

  try {
    let completedBatches = 0;
    let completedItems = 0;

    for (const eventBatch of eventBatches) {
      const result = await enrichEventBatch(client, eventBatch, {
        ...bundle,
        events,
        people,
      });
      const nextByStableId = new Map(result.events.map((event) => [event.stableId, event]));
      events = events.map((event) => nextByStableId.get(event.stableId) ?? event);
      eventCount += result.enrichedCount;
      completedBatches += 1;
      completedItems += eventBatch.length;
      await options?.onProgress?.({
        phase: "events",
        completedBatches,
        totalBatches: eventBatches.length,
        completedItems,
        totalItems: bundle.events.length,
      });
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "event enrichment failed");
  }

  if (personBatches.length > 0) {
    try {
      let completedBatches = 0;
      let completedItems = 0;

      for (const personBatch of personBatches) {
        const result = await enrichPersonBatch(client, personBatch, {
          ...bundle,
          events,
          people,
        });
        const nextByStableId = new Map(result.people.map((person) => [person.stableId, person]));
        people = people.map((person) => nextByStableId.get(person.stableId) ?? person);
        personCount += result.enrichedCount;
        completedBatches += 1;
        completedItems += personBatch.length;
        await options?.onProgress?.({
          phase: "people",
          completedBatches,
          totalBatches: personBatches.length,
          completedItems,
          totalItems: bundle.people.length,
        });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "person enrichment failed");
    }
  }

  return {
    bundle: {
      ...bundle,
      events,
      people,
    },
    enabled: true,
    model: env.openAiModel,
    eventCount,
    personCount,
    errors,
  };
}

export { normalizeEventBatch, normalizePersonBatch };
