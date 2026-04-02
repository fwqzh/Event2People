import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("resolvePaperRuntimeMetadata", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock("@/lib/pdf-paper-institutions");
  });

  it("re-extracts institutions and lead author affiliations from stored pdf text", async () => {
    const { resolvePaperRuntimeMetadata } = await import("@/lib/paper-runtime");

    const result = await resolvePaperRuntimeMetadata({
      cacheKey: "paper:planning-kernel",
      paperUrl: "https://arxiv.org/abs/2503.01022",
      authors: ["Jian Wu", "Sofia Garcia"],
      authorEmails: [],
      institutionNames: [],
      pdfTextRaw: `
Embodied Planning Kernel
Jian Wu1, Sofia Garcia2
1 Department of Automation, Tsinghua University
2 Shanghai AI Laboratory

Abstract
This paper studies embodied planning.
`,
    });

    expect(result.institutionNames).toEqual(["Tsinghua University", "Shanghai AI Laboratory"]);
    expect(result.leadAuthorAffiliations).toEqual([
      { author: "Jian Wu", institutions: ["Tsinghua University"] },
      { author: "Sofia Garcia", institutions: ["Shanghai AI Laboratory"] },
    ]);
  });

  it("falls back to live pdf extraction when stored paper metadata is missing", async () => {
    const extractPaperDataFromPdf = vi.fn().mockResolvedValue({
      authors: ["Alice Chen", "Bob Li"],
      emails: ["alice@example.edu"],
      institutionNamesRaw: ["Stanford University", "MIT"],
      pdfTextRaw: `
Goal-Aware Push-Grasp Policy
Alice Chen1, Bob Li2
1 Stanford University
2 MIT
Abstract
This paper studies push-grasp manipulation.
`,
    });

    vi.doMock("@/lib/pdf-paper-institutions", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/pdf-paper-institutions")>();
      return {
        ...actual,
        extractPaperDataFromPdf,
      };
    });

    const { resolvePaperRuntimeMetadata } = await import("@/lib/paper-runtime");

    const result = await resolvePaperRuntimeMetadata({
      cacheKey: "paper:gapg",
      paperUrl: "https://arxiv.org/abs/2603.12345",
      authors: ["Alice Chen", "Bob Li"],
      authorEmails: [],
      institutionNames: [],
      pdfTextRaw: "",
    });

    expect(extractPaperDataFromPdf).toHaveBeenCalledWith("https://arxiv.org/pdf/2603.12345.pdf", ["Alice Chen", "Bob Li"]);
    expect(result.institutionNames).toEqual(["Stanford University", "MIT"]);
    expect(result.leadAuthorAffiliations).toEqual([
      { author: "Alice Chen", institutions: ["Stanford University"] },
      { author: "Bob Li", institutions: ["MIT"] },
    ]);
  });
});
