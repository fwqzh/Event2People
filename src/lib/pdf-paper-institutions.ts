import path from "node:path";
import { pathToFileURL } from "node:url";

type PdfTextToken = {
  str?: string;
  transform?: number[];
  height?: number;
  width?: number;
};

type TextLine = {
  y: number;
  height: number;
  tokens: Array<{
    x: number;
    text: string;
  }>;
};

const INSTITUTION_KEYWORDS = [
  "university",
  "univeristy",
  "université",
  "universitat",
  "universität",
  "universidad",
  "universidade",
  "institute",
  "institut",
  "laboratory",
  "laboratories",
  "lab",
  "labs",
  "college",
  "school",
  "academy",
  "centre",
  "center",
  "department",
  "hospital",
  "research",
  "campus",
  "polytechnic",
  "人工智能实验室",
  "大学",
  "学院",
  "研究院",
  "研究所",
  "实验室",
  "实验中心",
  "中心",
  "医院",
  "公司",
  "科学院",
];

const ABSTRACT_LINE_PATTERN = /^(abstract|摘要)\b/i;
const SECTION_START_PATTERN = /^(\d+(\.\d+)*)\s+(introduction|background|preliminar|related work|引言|背景)/i;
const EMAIL_OR_URL_PATTERN = /@|https?:\/\/|www\./i;
const AUTHOR_MARKER_PATTERN = /[*†‡§¶‖#]+|\b(corresponding author|equal contribution)\b/i;
const SIMPLE_EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const GROUPED_EMAIL_PATTERN = /\{([^{}@\n]+)\}@([A-Z0-9.-]+\.[A-Z]{2,})/gi;

export type ExtractedPdfPaperData = {
  pdfTextRaw: string;
  authors: string[];
  emails: string[];
  institutionNamesRaw: string[];
};

export type AuthorAffiliation = {
  author: string;
  institutions: string[];
};

export type AuthorContactProfile = {
  author: string;
  institutions: string[];
  emails: string[];
};

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function extractLeadLines(text: string, maxLines = 120) {
  return text
    .split("\n")
    .map((line) => compactText(line))
    .filter(Boolean)
    .slice(0, maxLines);
}

function normalizeInstitutionSignalText(value: string) {
  return compactText(value)
    .replace(/^[\d\s,*†‡§¶‖#()\-–—]+/, "")
    .replace(/[\d\s,*†‡§¶‖#()\-–—]+$/g, "")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksLikeInstitutionAcronym(value: string) {
  return /^[A-Z]{2,10}(?:\s+[A-Z]{2,10}){0,3}$/.test(normalizeInstitutionSignalText(value));
}

function looksLikeSentenceFragment(value: string) {
  const allowedLowercaseTokens = new Set(["of", "the", "and", "for", "at", "in", "on", "de", "di", "von", "la", "le"]);
  const tokens = compactText(value)
    .replace(/[(),.;:]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const disallowedLowercaseTokens = tokens.filter(
    (token) => /^[a-z][a-z-]+$/.test(token) && !allowedLowercaseTokens.has(token.toLowerCase()),
  );

  return disallowedLowercaseTokens.length >= 2;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => compactText(value)).filter(Boolean))];
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = compactText(value).replace(/^mailto:/i, "");
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalized) ? normalized : "";
}

function joinTokens(tokens: string[]) {
  return tokens.reduce((result, token) => {
    const next = compactText(token);

    if (!next) {
      return result;
    }

    if (!result) {
      return next;
    }

    if (/^[,.;:)\]}]/.test(next) || /[(\[{/]$/.test(result) || result.endsWith("-")) {
      return `${result}${next}`;
    }

    return `${result} ${next}`;
  }, "");
}

function buildTextLines(items: PdfTextToken[]) {
  const normalized = items
    .map((item) => ({
      text: compactText(item.str),
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
      height: Math.abs(item.height ?? item.transform?.[3] ?? 0),
    }))
    .filter((item) => item.text);

  const sorted = normalized.sort((left, right) => {
    if (Math.abs(left.y - right.y) > 2.5) {
      return right.y - left.y;
    }

    return left.x - right.x;
  });

  const lines: TextLine[] = [];

  for (const item of sorted) {
    const tolerance = Math.max(2.5, item.height * 0.45);
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);

    if (!line) {
      lines.push({
        y: item.y,
        height: item.height,
        tokens: [{ x: item.x, text: item.text }],
      });
      continue;
    }

    line.tokens.push({ x: item.x, text: item.text });
    line.height = Math.max(line.height, item.height);
  }

  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => joinTokens(line.tokens.sort((left, right) => left.x - right.x).map((token) => token.text)))
    .map((line) => compactText(line))
    .filter(Boolean);
}

function removeAuthorNames(text: string, authors: string[]) {
  return authors.reduce((result, author) => {
    const escaped = escapeRegExp(author);
    return result.replace(new RegExp(escaped, "gi"), " ");
  }, text);
}

function cleanInstitutionCandidate(candidate: string, authors: string[]) {
  let cleaned = compactText(candidate)
    .replace(/^[\d\s,*†‡§¶‖#()\-–—]+/, "")
    .replace(/[\d\s,*†‡§¶‖#()\-–—]+$/, "")
    .replace(/\buniveristy\b/gi, "University")
    .replace(/\s{2,}/g, " ");

  if (cleaned.includes("(") && !cleaned.includes(")")) {
    cleaned = cleaned.split("(")[0]?.trim() ?? cleaned;
  }

  cleaned = removeAuthorNames(cleaned, authors)
    .replace(AUTHOR_MARKER_PATTERN, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(and|with)\b\s*$/i, "")
    .replace(/[;,/]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  if (EMAIL_OR_URL_PATTERN.test(cleaned) || ABSTRACT_LINE_PATTERN.test(cleaned) || /^arxiv\b/i.test(cleaned)) {
    return "";
  }

  if ((cleaned.length < 6 && !looksLikeInstitutionAcronym(cleaned)) || cleaned.length > 120) {
    return "";
  }

  if (looksLikeSentenceFragment(cleaned)) {
    return "";
  }

  return cleaned;
}

function hasInstitutionSignal(text: string) {
  const lowered = text.toLowerCase();
  return (
    INSTITUTION_KEYWORDS.some((keyword) => {
      if (/[\u4e00-\u9fff]/.test(keyword)) {
        return lowered.includes(keyword);
      }

      return new RegExp(`(^|[^a-z])${escapeRegExp(keyword.toLowerCase())}([^a-z]|$)`, "i").test(lowered);
    }) || looksLikeInstitutionAcronym(text)
  );
}

function rankInstitutionCandidate(text: string) {
  const lowered = text.toLowerCase();
  let score = 0;

  if (/\buniversity\b|大学/i.test(lowered)) {
    score += 5;
  }

  if (/\binstitute\b|研究院|研究所|科学院/i.test(lowered)) {
    score += 4;
  }

  if (/\blab\b|\blaboratory\b|实验室/i.test(lowered)) {
    score += 4;
  }

  if (/\bdepartment\b|学院|school|college/i.test(lowered)) {
    score += 2;
  }

  if (looksLikeInstitutionAcronym(text)) {
    score += 3;
  }

  if (/,/.test(text) || /，/.test(text)) {
    score += 1;
  }

  return score;
}

function toPrimaryInstitutionCandidate(candidate: string) {
  const segments = candidate
    .split(",")
    .map((segment) => compactText(segment))
    .filter(Boolean);

  const signalIndexes = segments
    .map((segment, index) => (hasInstitutionSignal(segment) ? index : -1))
    .filter((index) => index >= 0);

  if (signalIndexes.length === 1 && signalIndexes[0] === 0 && segments.length > 1) {
    return candidate;
  }

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (hasInstitutionSignal(segments[index] ?? "")) {
      return segments[index] ?? candidate;
    }
  }

  return candidate;
}

function extractHeaderText(text: string) {
  const lines = text
    .split("\n")
    .map((line) => compactText(line))
    .filter(Boolean);

  const headerLines: string[] = [];

  for (const line of lines.slice(0, 80)) {
    if (ABSTRACT_LINE_PATTERN.test(line) || SECTION_START_PATTERN.test(line)) {
      break;
    }

    headerLines.push(line);
  }

  return headerLines;
}

function sliceInstitutionFragments(line: string) {
  const fragments = line
    .split(/\s*[;|]\s*|\s{2,}/)
    .map((part) => compactText(part))
    .filter(Boolean);

  return fragments.length > 0 ? fragments : [line];
}

function hasAffiliationMarker(value: string) {
  return /^[\d*†‡§¶‖#]/.test(compactText(value));
}

function isLikelyAffiliationFragment(value: string, lineIndex: number) {
  return lineIndex < 30 || hasAffiliationMarker(value);
}

function extractAffiliationMarkers(value: string | null | undefined) {
  return uniqueStrings(
    compactText(value)
      .match(/[*†‡§¶‖#]+|\d+/g)
      ?.map((marker) => marker.trim()) ?? [],
  );
}

function findInstitutionRegexMatches(headerBlock: string) {
  const matches = [
    ...headerBlock.matchAll(
      /\b([A-Z][A-Za-z&'’.,\- ]{1,90}(?:University|Institute|Laboratory|Laboratories|Lab|Labs|College|School|Academy|Center|Centre|Hospital|Department)\b[A-Za-z&'’.,\- ]{0,40})/g,
    ),
    ...headerBlock.matchAll(
      /([A-Za-z0-9·（）()&'’.,\- ]{1,80}(?:大学|学院|研究院|研究所|实验室|实验中心|中心|医院|科学院)[A-Za-z0-9·（）()&'’.,\- ]{0,20})/g,
    ),
  ];

  return matches.map((match) => compactText(match[1] ?? ""));
}

function extractEmailsFromText(text: string) {
  const groupedEmails = [...text.matchAll(GROUPED_EMAIL_PATTERN)].flatMap((match) => {
    const localParts = compactText(match[1])
      .split(/\s*,\s*|\s*;\s*|\s*\/\s*/)
      .map((part) => normalizeEmail(`${part}@${match[2]}`))
      .filter(Boolean);

    return localParts;
  });

  const simpleEmails = (text.match(SIMPLE_EMAIL_PATTERN) ?? []).map((value) => normalizeEmail(value)).filter(Boolean);

  return uniqueStrings([...groupedEmails, ...simpleEmails]);
}

function normalizeEmailLocalPart(value: string | null | undefined) {
  return compactText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getAuthorNameTokens(author: string) {
  return compactText(author)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function scoreEmailAuthorMatch(localPart: string, author: string) {
  const normalizedLocalPart = normalizeEmailLocalPart(localPart);
  const tokens = getAuthorNameTokens(author);
  const first = tokens[0] ?? "";
  const last = tokens.at(-1) ?? "";
  const joined = tokens.join("");
  const firstLast = `${first}${last}`;
  const lastFirst = `${last}${first}`;
  const firstInitialLast = `${first.charAt(0)}${last}`;
  const lastFirstInitial = `${last}${first.charAt(0)}`;
  const firstLastInitial = `${first}${last.charAt(0)}`;

  if (!normalizedLocalPart || !first || !last) {
    return 0;
  }

  if (normalizedLocalPart === joined) {
    return 10;
  }

  if (normalizedLocalPart === firstLast || normalizedLocalPart === lastFirst) {
    return 9;
  }

  if (
    normalizedLocalPart === firstInitialLast ||
    normalizedLocalPart === lastFirstInitial ||
    normalizedLocalPart === firstLastInitial
  ) {
    return 8;
  }

  if (normalizedLocalPart.startsWith(first) && normalizedLocalPart.includes(last)) {
    return 7;
  }

  if (normalizedLocalPart.startsWith(last) && normalizedLocalPart.includes(first.charAt(0))) {
    return 6;
  }

  if (normalizedLocalPart.includes(first) && normalizedLocalPart.includes(last)) {
    return 5;
  }

  if (normalizedLocalPart === first || normalizedLocalPart === last) {
    return 2;
  }

  if (last.length >= 4 && normalizedLocalPart.includes(last)) {
    return 1;
  }

  return 0;
}

function findBestMatchingAuthor(localPart: string, authors: string[]) {
  let bestAuthor = "";
  let bestScore = 0;
  let isTie = false;

  for (const author of authors) {
    const score = scoreEmailAuthorMatch(localPart, author);

    if (score > bestScore) {
      bestAuthor = author;
      bestScore = score;
      isTie = false;
      continue;
    }

    if (score > 0 && score === bestScore) {
      isTie = true;
    }
  }

  return bestScore > 0 && !isTie ? bestAuthor : "";
}

export function assignEmailsToAuthors(emails: string[], authors: string[], maxAuthors = authors.length) {
  const resolvedAuthors = uniqueStrings(authors).slice(0, maxAuthors);

  if (resolvedAuthors.length === 0) {
    return [] satisfies AuthorContactProfile[];
  }

  const normalizedEmails = uniqueStrings(emails.map((email) => normalizeEmail(email)).filter(Boolean));
  const emailsByAuthor = new Map<string, string[]>();

  for (const email of normalizedEmails) {
    const matchedAuthor = findBestMatchingAuthor(email.split("@")[0] ?? "", resolvedAuthors);

    if (!matchedAuthor) {
      continue;
    }

    const currentEmails = emailsByAuthor.get(matchedAuthor) ?? [];
    currentEmails.push(email);
    emailsByAuthor.set(matchedAuthor, currentEmails);
  }

  if (normalizedEmails.length === resolvedAuthors.length) {
    normalizedEmails.forEach((email, index) => {
      const author = resolvedAuthors[index];

      if (!author || (emailsByAuthor.get(author)?.length ?? 0) > 0) {
        return;
      }

      emailsByAuthor.set(author, [...(emailsByAuthor.get(author) ?? []), email]);
    });
  }

  return resolvedAuthors.map((author) => ({
    author,
    institutions: [],
    emails: uniqueStrings(emailsByAuthor.get(author) ?? []),
  })) satisfies AuthorContactProfile[];
}

function looksLikePersonName(value: string) {
  const candidate = compactText(value)
    .replace(/^[\d\s,*†‡§¶‖#()\-–—]+/, "")
    .replace(/[\d\s,*†‡§¶‖#()\-–—]+$/g, "")
    .replace(/\s{2,}/g, " ");
  const tokens = candidate.split(/\s+/).filter(Boolean);

  if (tokens.length < 2 || tokens.length > 4) {
    return false;
  }

  if (hasInstitutionSignal(candidate) || EMAIL_OR_URL_PATTERN.test(candidate) || ABSTRACT_LINE_PATTERN.test(candidate)) {
    return false;
  }

  if (candidate.length > 48) {
    return false;
  }

  return tokens.every((token) => /^[A-Z][A-Za-z.'’`-]*$/.test(token));
}

function extractAuthorNamesFromText(text: string, fallbackAuthors: string[]) {
  const headerLines = extractHeaderText(text);
  const headerBlock = headerLines.join("\n");
  const matchedFallbackAuthors = uniqueStrings(
    fallbackAuthors.filter((author) => new RegExp(`(^|\\b)${escapeRegExp(author)}($|\\b)`, "i").test(headerBlock)),
  );

  if (matchedFallbackAuthors.length > 0) {
    return matchedFallbackAuthors;
  }

  const authorCandidates = headerLines
    .slice(1, 20)
    .flatMap((line) => {
      const cleanedLine = compactText(
        line
          .replace(AUTHOR_MARKER_PATTERN, " ")
          .replace(/[*†‡§¶‖#]/g, " ")
          .replace(/\([^)]*(equal contribution|corresponding author)[^)]*\)/gi, " ")
          .replace(/\s{2,}/g, " "),
      );

      if (!cleanedLine || hasInstitutionSignal(cleanedLine) || EMAIL_OR_URL_PATTERN.test(cleanedLine)) {
        return [];
      }

      return cleanedLine
        .split(/\s*,\s*|\s+and\s+|\s*&\s*|\s*;\s*/i)
        .map((part) =>
          compactText(part)
            .replace(/^[\d\s,*†‡§¶‖#()\-–—]+/, "")
            .replace(/[\d\s,*†‡§¶‖#()\-–—]+$/g, ""),
        )
        .filter(looksLikePersonName);
    });

  return uniqueStrings(authorCandidates);
}

function buildInstitutionMarkerMap(headerLines: string[], authors: string[]) {
  const markerMap = new Map<string, string>();

  for (const [lineIndex, line] of headerLines.entries()) {
    if (!hasInstitutionSignal(line)) {
      continue;
    }

    const leadingMarkerMatch = compactText(line).match(/^([*†‡§¶‖#\d,\s]+)(?=\S)/);
    const trailingMarkerMatch = compactText(line).match(/([*†‡§¶‖#\d,\s]+)$/);

    for (const fragment of sliceInstitutionFragments(line)) {
      if (!hasInstitutionSignal(fragment) || !isLikelyAffiliationFragment(fragment, lineIndex)) {
        continue;
      }

      const institution = toPrimaryInstitutionCandidate(cleanInstitutionCandidate(fragment, authors));

      if (!institution || !hasInstitutionSignal(institution)) {
        continue;
      }

      const markers = extractAffiliationMarkers(
        [
          compactText(fragment).match(/^([*†‡§¶‖#\d,\s]+)(?=\S)/)?.[1] ?? leadingMarkerMatch?.[1],
          compactText(fragment).match(/([*†‡§¶‖#\d,\s]+)$/)?.[1] ?? trailingMarkerMatch?.[1],
        ]
          .filter(Boolean)
          .join(" "),
      );

      for (const marker of markers) {
        if (!markerMap.has(marker)) {
          markerMap.set(marker, institution);
        }
      }
    }
  }

  return markerMap;
}

function buildAuthorMarkerMap(headerBlock: string, authors: string[]) {
  const markerMap = new Map<string, string[]>();

  for (const author of authors) {
    const trailingMatches = [
      ...headerBlock.matchAll(
        new RegExp(`${escapeRegExp(author)}\\s*([*†‡§¶‖#\\d]+(?:\\s*,\\s*[*†‡§¶‖#\\d]+)*)`, "gi"),
      ),
    ];
    const leadingMatches = [
      ...headerBlock.matchAll(
        new RegExp(`(?:^|[,;\\n])\\s*([*†‡§¶‖#\\d]+(?:\\s*,\\s*[*†‡§¶‖#\\d]+)*)\\s*${escapeRegExp(author)}`, "gi"),
      ),
    ];
    const markers = extractAffiliationMarkers(
      [...trailingMatches.map((match) => match[1]), ...leadingMatches.map((match) => match[1])]
        .filter(Boolean)
        .join(" "),
    );

    if (markers.length > 0) {
      markerMap.set(author, markers);
    }
  }

  return markerMap;
}

export function extractAuthorAffiliationsFromText(text: string, authors: string[], maxAuthors = 3) {
  const resolvedAuthors = uniqueStrings(authors).slice(0, maxAuthors);

  if (resolvedAuthors.length === 0) {
    return [] satisfies AuthorAffiliation[];
  }

  const leadLines = extractLeadLines(text);
  const leadBlock = leadLines.join("\n");
  const institutionNames = extractInstitutionNamesFromText(text, resolvedAuthors);
  const institutionMarkerMap = buildInstitutionMarkerMap(leadLines, resolvedAuthors);
  const authorMarkerMap = buildAuthorMarkerMap(leadBlock, resolvedAuthors);

  return resolvedAuthors
    .map((author, index) => {
      const institutionsFromMarkers = uniqueStrings(
        (authorMarkerMap.get(author) ?? []).map((marker) => institutionMarkerMap.get(marker) ?? ""),
      );

      if (institutionsFromMarkers.length > 0) {
        return {
          author,
          institutions: institutionsFromMarkers,
        } satisfies AuthorAffiliation;
      }

      const fallbackInstitution = institutionNames[index] ?? institutionNames[0] ?? "";

      if (!fallbackInstitution) {
        return null;
      }

      return {
        author,
        institutions: [fallbackInstitution],
      } satisfies AuthorAffiliation;
    })
    .filter((value): value is AuthorAffiliation => Boolean(value));
}

export function extractAuthorContactProfilesFromText(text: string, authors: string[], maxAuthors = authors.length) {
  const resolvedAuthors = uniqueStrings(authors).slice(0, maxAuthors);

  if (resolvedAuthors.length === 0) {
    return [] satisfies AuthorContactProfile[];
  }

  const affiliationsByAuthor = new Map(
    extractAuthorAffiliationsFromText(text, resolvedAuthors, maxAuthors).map((item) => [item.author, item.institutions]),
  );
  const emailsByAuthor = new Map(
    assignEmailsToAuthors(extractEmailsFromText(text), resolvedAuthors, maxAuthors).map((item) => [item.author, item.emails]),
  );

  return resolvedAuthors.map((author) => ({
    author,
    institutions: uniqueStrings(affiliationsByAuthor.get(author) ?? []),
    emails: uniqueStrings(emailsByAuthor.get(author) ?? []),
  })) satisfies AuthorContactProfile[];
}

export function extractPaperDataFromText(text: string, fallbackAuthors: string[]) {
  const authors = extractAuthorNamesFromText(text, fallbackAuthors);
  const resolvedAuthors = authors.length > 0 ? authors : fallbackAuthors;

  return {
    pdfTextRaw: text,
    authors: resolvedAuthors,
    emails: extractEmailsFromText(text),
    institutionNamesRaw: extractInstitutionNamesFromText(text, resolvedAuthors),
  } satisfies ExtractedPdfPaperData;
}

export function extractInstitutionNamesFromText(text: string, authors: string[]) {
  const leadLines = extractLeadLines(text);
  const headerBlock = extractHeaderText(text).join("\n");
  const lineCandidates = leadLines.flatMap((line, lineIndex) =>
    sliceInstitutionFragments(line).filter(
      (fragment) => hasInstitutionSignal(fragment) && isLikelyAffiliationFragment(fragment, lineIndex),
    ),
  );
  const regexCandidates = findInstitutionRegexMatches(headerBlock);

  return uniqueStrings(
    [...lineCandidates, ...regexCandidates]
      .map((candidate) => cleanInstitutionCandidate(candidate, authors))
      .map((candidate) => toPrimaryInstitutionCandidate(candidate))
      .filter(hasInstitutionSignal)
      .sort((left, right) => rankInstitutionCandidate(right) - rankInstitutionCandidate(left)),
  ).slice(0, 4);
}

export async function extractInstitutionNamesFromPdf(pdfUrl: string, authors: string[]) {
  const extracted = await extractPaperDataFromPdf(pdfUrl, authors);
  return extracted.institutionNamesRaw;
}

export async function extractPaperDataFromPdf(pdfUrl: string, fallbackAuthors: string[]) {
  const response = await fetch(pdfUrl, {
    headers: {
      "User-Agent": "Event2People/1.0",
      Accept: "application/pdf",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`PDF fetch failed: ${response.status}`);
  }

  const pdfBytes = new Uint8Array(await response.arrayBuffer());
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfWorkerSrc = pathToFileURL(path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")).toString();
  const standardFontDataUrl = pathToFileURL(path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")).toString();
  GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  const loadingTask = getDocument({
    data: pdfBytes,
    standardFontDataUrl: standardFontDataUrl.endsWith("/") ? standardFontDataUrl : `${standardFontDataUrl}/`,
  });

  try {
    const doc = await loadingTask.promise;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = buildTextLines(content.items as PdfTextToken[]);
      pageTexts.push(lines.join("\n"));
      page.cleanup();
    }

    return extractPaperDataFromText(pageTexts.join("\n\n"), fallbackAuthors);
  } finally {
    await loadingTask.destroy();
  }
}
