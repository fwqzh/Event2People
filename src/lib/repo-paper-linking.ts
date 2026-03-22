export type RepoPaperEvidence = {
  projectTitle: string;
  paperTitle: string;
  readmeText?: string | null;
  projectDescription?: string | null;
  paperCodeUrl?: string | null;
  paperUrl?: string | null;
};

export type RepoPaperDecision = {
  confidence: "confirmed" | "candidate" | "none";
  evidenceType: string;
  evidenceExcerpt: string;
};

export function decideRepoPaperLink(evidence: RepoPaperEvidence): RepoPaperDecision {
  const haystack = `${evidence.readmeText ?? ""}\n${evidence.projectDescription ?? ""}`.toLowerCase();
  const normalizedPaperTitle = evidence.paperTitle.toLowerCase();
  const titleOverlap =
    normalizedPaperTitle.length > 10 &&
    haystack.includes(normalizedPaperTitle.slice(0, Math.min(normalizedPaperTitle.length, 18)));

  if (evidence.paperCodeUrl) {
    return {
      confidence: "confirmed",
      evidenceType: "paper_code_url",
      evidenceExcerpt: "paper metadata 提供 code_url",
    };
  }

  if (evidence.paperUrl && haystack.includes(evidence.paperUrl.toLowerCase())) {
    return {
      confidence: "confirmed",
      evidenceType: "readme_arxiv_link",
      evidenceExcerpt: "README 中存在明确论文链接",
    };
  }

  if (titleOverlap && /\b(arxiv|paper|论文|implementation|实现)\b/i.test(haystack)) {
    return {
      confidence: "confirmed",
      evidenceType: "title_plus_context",
      evidenceExcerpt: "repo 与 paper 标题高相关且正文有佐证",
    };
  }

  if (titleOverlap) {
    return {
      confidence: "candidate",
      evidenceType: "weak_title_match",
      evidenceExcerpt: "仅存在弱标题相关",
    };
  }

  return {
    confidence: "none",
    evidenceType: "none",
    evidenceExcerpt: "未发现明确佐证",
  };
}
