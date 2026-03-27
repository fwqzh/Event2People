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

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => compactText(value)).filter(Boolean))];
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
    const escaped = author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return result.replace(new RegExp(escaped, "gi"), " ");
  }, text);
}

function cleanInstitutionCandidate(candidate: string, authors: string[]) {
  let cleaned = compactText(candidate)
    .replace(/^[\d\s,*†‡§¶‖#()\-–—]+/, "")
    .replace(/[\d\s,*†‡§¶‖#()\-–—]+$/, "")
    .replace(/\s{2,}/g, " ");

  cleaned = removeAuthorNames(cleaned, authors)
    .replace(AUTHOR_MARKER_PATTERN, " ")
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

  if (cleaned.length < 6 || cleaned.length > 120) {
    return "";
  }

  return cleaned;
}

function hasInstitutionSignal(text: string) {
  const lowered = text.toLowerCase();
  return INSTITUTION_KEYWORDS.some((keyword) => lowered.includes(keyword));
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

  for (const line of lines.slice(0, 36)) {
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

export function extractInstitutionNamesFromText(text: string, authors: string[]) {
  const headerLines = extractHeaderText(text);
  const headerBlock = headerLines.join("\n");
  const lineCandidates = headerLines.flatMap((line) =>
    sliceInstitutionFragments(line).filter((fragment) => hasInstitutionSignal(fragment)),
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
  const response = await fetch(pdfUrl, {
    headers: {
      "User-Agent": "Event2People/1.0",
      Accept: "application/pdf",
    },
    next: { revalidate: 60 * 60 * 24 },
  });

  if (!response.ok) {
    throw new Error(`PDF fetch failed: ${response.status}`);
  }

  const pdfBytes = new Uint8Array(await response.arrayBuffer());
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({ data: pdfBytes });

  try {
    const doc = await loadingTask.promise;
    const maxPages = Math.min(doc.numPages, 2);
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = buildTextLines(content.items as PdfTextToken[]);
      pageTexts.push(lines.join("\n"));
      page.cleanup();
    }

    return extractInstitutionNamesFromText(pageTexts.join("\n"), authors);
  } finally {
    await loadingTask.destroy();
  }
}
