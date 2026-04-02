import { extractAuthorAffiliationsFromText, extractInstitutionNamesFromText, extractPaperDataFromPdf } from "@/lib/pdf-paper-institutions";
import { compactInstitution, uniqueStrings } from "@/lib/text";

const RUNTIME_PAPER_CACHE_TTL_MS = 6 * 60 * 60_000;

export type ResolvedPaperRuntimeMetadata = {
  authors: string[];
  authorEmails: string[];
  institutionNames: string[];
  leadAuthorAffiliations: Array<{
    author: string;
    institutions: string[];
  }>;
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

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function preservePdfText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function buildLeadAuthorAffiliations(pdfTextRaw: string, authors: string[], institutionNames: string[]) {
  const extracted = extractAuthorAffiliationsFromText(pdfTextRaw, authors)
    .map((item) => ({
      author: item.author,
      institutions: normalizeInstitutions(item.institutions),
    }))
    .filter((item) => item.institutions.length > 0);
  const extractedByAuthor = new Map(extracted.map((item) => [item.author, item.institutions]));

  return authors
    .slice(0, 3)
    .map((author, index) => {
      const institutions = extractedByAuthor.get(author) ?? (institutionNames[index] ? [institutionNames[index]] : []);

      if (institutions.length === 0) {
        return null;
      }

      return {
        author,
        institutions,
      };
    })
    .filter((item): item is { author: string; institutions: string[] } => Boolean(item));
}

function resolveFromPdfText(input: {
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
  const leadAuthorAffiliations = buildLeadAuthorAffiliations(pdfTextRaw, authors, institutionNames);

  return {
    authors,
    authorEmails: uniqueStrings(input.authorEmails),
    institutionNames,
    leadAuthorAffiliations,
    pdfTextRaw,
  } satisfies ResolvedPaperRuntimeMetadata;
}

function shouldFetchPdf(metadata: ResolvedPaperRuntimeMetadata) {
  return !metadata.pdfTextRaw || metadata.institutionNames.length === 0 || metadata.leadAuthorAffiliations.length === 0;
}

export async function resolvePaperRuntimeMetadata(input: PaperRuntimeInput): Promise<ResolvedPaperRuntimeMetadata> {
  const cached = runtimePaperCache.get(input.cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let resolved = resolveFromPdfText({
    authors: input.authors,
    authorEmails: input.authorEmails,
    institutionNames: input.institutionNames,
    pdfTextRaw: preservePdfText(input.pdfTextRaw),
  });

  if (shouldFetchPdf(resolved)) {
    try {
      const extracted = await extractPaperDataFromPdf(toPaperPdfUrl(input.paperUrl), resolved.authors);
      resolved = resolveFromPdfText({
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
}
