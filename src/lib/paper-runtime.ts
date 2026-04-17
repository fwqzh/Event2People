import { z } from "zod";

import { getOpenAiClient } from "@/lib/openai-runtime";
import { assignEmailsToAuthors, extractAuthorContactProfilesFromText, extractInstitutionNamesFromText, extractPaperDataFromPdf } from "@/lib/pdf-paper-institutions";
import { compactInstitution, uniqueStrings } from "@/lib/text";

const RUNTIME_PAPER_CACHE_TTL_MS = 6 * 60 * 60_000;
const AI_REQUEST_TIMEOUT_MS = 45_000;
const AI_PDF_CONTEXT_CHAR_LIMIT = 12_000;

const PaperAuthorProfilesSchema = z.object({
  items: z.array(
    z.object({
      author: z.string(),
      institutions: z.array(z.string()).default([]),
      emails: z.array(z.string()).default([]),
    }),
  ),
});

type PaperAuthorProfilesOutput = z.infer<typeof PaperAuthorProfilesSchema>;

export type ResolvedPaperAuthorProfile = {
  author: string;
  institutions: string[];
  emails: string[];
};

export type ResolvedPaperRuntimeMetadata = {
  authors: string[];
  authorEmails: string[];
  institutionNames: string[];
  leadAuthorAffiliations: Array<{
    author: string;
    institutions: string[];
  }>;
  authorProfiles: ResolvedPaperAuthorProfile[];
  pdfTextRaw: string;
};

type PaperRuntimeInput = {
  cacheKey: string;
  paperUrl: string;
  authors: string[];
  authorEmails: string[];
  institutionNames: string[];
  pdfTextRaw: string | null | undefined;
};

const runtimePaperCache = new Map<string, { expiresAt: number; value: ResolvedPaperRuntimeMetadata }>();
const runtimePaperPendingCache = new Map<string, Promise<ResolvedPaperRuntimeMetadata>>();

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function preservePdfText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = compactText(value).replace(/^mailto:/i, "");
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalized) ? normalized : "";
}

function normalizeAuthorName(value: string | null | undefined) {
  return compactText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

function toPaperPdfUrl(paperUrl: string) {
  const normalized = compactText(paperUrl);

  if (/arxiv\.org\/pdf\//i.test(normalized)) {
    return normalized.endsWith(".pdf") ? normalized : `${normalized}.pdf`;
  }

  if (/arxiv\.org\/abs\//i.test(normalized)) {
    return normalized.replace("/abs/", "/pdf/").replace(/\/?$/, ".pdf");
  }

  return normalized;
}

function normalizeInstitutions(values: string[]) {
  return uniqueStrings(values.map((value) => compactInstitution(value)).filter(Boolean));
}

function buildLeadAuthorAffiliations(authorProfiles: ResolvedPaperAuthorProfile[], institutionNames: string[]) {
  return authorProfiles
    .slice(0, 3)
    .map((profile, index) => {
      const institutions = profile.institutions.length > 0 ? profile.institutions : institutionNames[index] ? [institutionNames[index]] : [];

      if (institutions.length === 0) {
        return null;
      }

      return {
        author: profile.author,
        institutions,
      };
    })
    .filter((item): item is { author: string; institutions: string[] } => Boolean(item));
}

function buildPdfAuthorExtractionContext(pdfTextRaw: string) {
  const lines = preservePdfText(pdfTextRaw)
    .split("\n")
    .map((line) => compactText(line))
    .filter(Boolean);
  const headerLines = lines.slice(0, 160);
  const emailLines = lines.filter((line) => /@/.test(line)).slice(0, 20);

  return uniqueStrings([...headerLines, ...emailLines]).join("\n").slice(0, AI_PDF_CONTEXT_CHAR_LIMIT);
}

function normalizeAiAuthorProfiles(output: PaperAuthorProfilesOutput, authors: string[]) {
  const authorNameMap = new Map(authors.map((author) => [normalizeAuthorName(author), author]));
  const profilesByAuthor = new Map<string, ResolvedPaperAuthorProfile>();

  for (const item of output.items) {
    const matchedAuthor = authorNameMap.get(normalizeAuthorName(item.author));

    if (!matchedAuthor) {
      continue;
    }

    const existing = profilesByAuthor.get(matchedAuthor) ?? {
      author: matchedAuthor,
      institutions: [],
      emails: [],
    };
    profilesByAuthor.set(matchedAuthor, {
      author: matchedAuthor,
      institutions: normalizeInstitutions([...existing.institutions, ...item.institutions]),
      emails: uniqueStrings([...existing.emails, ...item.emails.map((email) => normalizeEmail(email)).filter(Boolean)]),
    });
  }

  return [...profilesByAuthor.values()];
}

async function extractAuthorProfilesWithAi(pdfTextRaw: string, authors: string[]) {
  if (!pdfTextRaw || authors.length === 0) {
    return [] satisfies ResolvedPaperAuthorProfile[];
  }

  const { client, config } = await getOpenAiClient({
    timeout: AI_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });

  if (!client) {
    return [] satisfies ResolvedPaperAuthorProfile[];
  }

  const completion = await client.chat.completions.create(
    {
      model: config.model,
      temperature: 0,
      max_completion_tokens: 900,
      messages: [
        {
          role: "system",
          content: [
            "You extract author affiliations and contact emails from academic paper PDF text.",
            "Use only the provided PDF excerpt and only the provided author list.",
            "Never invent institutions or emails that do not appear in the text.",
            "Prefer exact author-block evidence, footnotes, corresponding-author notes, and grouped emails.",
            'Return JSON only, in the format {"items":[{"author":"...","institutions":["..."],"emails":["..."]}]}',
            "For each item.author, copy one name from the provided author list exactly.",
            "Institutions should be concise canonical names. Emails must be literal addresses.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              task: "Extract author affiliations and contact emails from PDF text",
              authors,
              pdfExcerpt: buildPdfAuthorExtractionContext(pdfTextRaw),
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
  return normalizeAiAuthorProfiles(PaperAuthorProfilesSchema.parse(JSON.parse(extractJsonPayload(raw))), authors);
}

function buildAuthorProfiles(input: {
  authors: string[];
  authorEmails: string[];
  institutionNames: string[];
  pdfTextRaw: string;
  aiProfiles?: ResolvedPaperAuthorProfile[];
}) {
  const resolvedAuthors = uniqueStrings(input.authors);
  const ruleProfilesByAuthor = new Map(
    extractAuthorContactProfilesFromText(input.pdfTextRaw, resolvedAuthors).map((item) => [item.author, item]),
  );
  const aiProfilesByAuthor = new Map((input.aiProfiles ?? []).map((item) => [item.author, item]));
  const fallbackEmailsByAuthor = new Map(
    assignEmailsToAuthors(input.authorEmails, resolvedAuthors).map((item) => [item.author, item.emails]),
  );

  return resolvedAuthors.map((author, index) => ({
    author,
    institutions: normalizeInstitutions([
      ...(aiProfilesByAuthor.get(author)?.institutions ?? []),
      ...(ruleProfilesByAuthor.get(author)?.institutions ?? []),
      ...(input.institutionNames[index] ? [input.institutionNames[index]] : []),
    ]),
    emails: uniqueStrings([
      ...(aiProfilesByAuthor.get(author)?.emails ?? []),
      ...(ruleProfilesByAuthor.get(author)?.emails ?? []),
      ...(fallbackEmailsByAuthor.get(author) ?? []),
    ]),
  })) satisfies ResolvedPaperAuthorProfile[];
}

async function resolveFromPdfText(input: {
  authors: string[];
  authorEmails: string[];
  institutionNames: string[];
  pdfTextRaw: string;
}) {
  const authors = uniqueStrings(input.authors);
  const pdfTextRaw = input.pdfTextRaw;
  const institutionNames = normalizeInstitutions([
    ...input.institutionNames,
    ...extractInstitutionNamesFromText(pdfTextRaw, authors),
  ]);

  let aiProfiles: ResolvedPaperAuthorProfile[] = [];

  try {
    aiProfiles = await extractAuthorProfilesWithAi(pdfTextRaw, authors);
  } catch (error) {
    console.warn("Runtime PDF AI author enrichment fallback:", error instanceof Error ? error.message : "unknown ai error");
  }

  const authorProfiles = buildAuthorProfiles({
    authors,
    authorEmails: input.authorEmails,
    institutionNames,
    pdfTextRaw,
    aiProfiles,
  });
  const normalizedInstitutionNames = normalizeInstitutions([
    ...institutionNames,
    ...authorProfiles.flatMap((profile) => profile.institutions),
  ]);

  return {
    authors,
    authorEmails: uniqueStrings([
      ...input.authorEmails.map((email) => normalizeEmail(email)).filter(Boolean),
      ...authorProfiles.flatMap((profile) => profile.emails),
    ]),
    institutionNames: normalizedInstitutionNames,
    leadAuthorAffiliations: buildLeadAuthorAffiliations(authorProfiles, normalizedInstitutionNames),
    authorProfiles,
    pdfTextRaw,
  } satisfies ResolvedPaperRuntimeMetadata;
}

function shouldFetchPdf(metadata: ResolvedPaperRuntimeMetadata) {
  return (
    !metadata.pdfTextRaw ||
    metadata.institutionNames.length === 0 ||
    metadata.leadAuthorAffiliations.length === 0 ||
    metadata.authorProfiles.every((profile) => profile.institutions.length === 0 && profile.emails.length === 0)
  );
}

export async function resolvePaperRuntimeMetadata(input: PaperRuntimeInput): Promise<ResolvedPaperRuntimeMetadata> {
  const cached = runtimePaperCache.get(input.cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const pending = runtimePaperPendingCache.get(input.cacheKey);

  if (pending) {
    return pending;
  }

  const pendingPromise = (async () => {
    let resolved = await resolveFromPdfText({
      authors: input.authors,
      authorEmails: input.authorEmails,
      institutionNames: input.institutionNames,
      pdfTextRaw: preservePdfText(input.pdfTextRaw),
    });

    if (shouldFetchPdf(resolved)) {
      try {
        const extracted = await extractPaperDataFromPdf(toPaperPdfUrl(input.paperUrl), resolved.authors);
        resolved = await resolveFromPdfText({
          authors: uniqueStrings([...extracted.authors, ...resolved.authors]),
          authorEmails: uniqueStrings([...resolved.authorEmails, ...extracted.emails]),
          institutionNames: normalizeInstitutions([...resolved.institutionNames, ...extracted.institutionNamesRaw]),
          pdfTextRaw: extracted.pdfTextRaw || resolved.pdfTextRaw,
        });
      } catch (error) {
        console.warn("Runtime PDF paper enrichment fallback:", error instanceof Error ? error.message : "unknown pdf error");
      }
    }

    runtimePaperCache.set(input.cacheKey, {
      expiresAt: Date.now() + RUNTIME_PAPER_CACHE_TTL_MS,
      value: resolved,
    });

    return resolved;
  })();

  runtimePaperPendingCache.set(input.cacheKey, pendingPromise);

  try {
    return await pendingPromise;
  } finally {
    runtimePaperPendingCache.delete(input.cacheKey);
  }
}
