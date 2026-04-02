import { describe, expect, it } from "vitest";

import {
  extractAuthorAffiliationsFromText,
  extractInstitutionNamesFromText,
  extractPaperDataFromText,
} from "@/lib/pdf-paper-institutions";

describe("pdf paper institution extraction", () => {
  it("extracts institution names from a typical author block", () => {
    const text = `
Embodied Planning Kernel
Jian Wu1, Sofia Garcia2
1 Department of Automation, Tsinghua University
2 Shanghai AI Laboratory
Abstract
Planning primitives for embodied agents in cluttered scenes.
`;

    expect(extractInstitutionNamesFromText(text, ["Jian Wu", "Sofia Garcia"])).toEqual([
      "Tsinghua University",
      "Shanghai AI Laboratory",
    ]);
  });

  it("filters emails and stops before body sections", () => {
    const text = `
Robot Web Pilot
Alice Chen1, Jian Wu2
1 Stanford University
2 Robotics Institute, Carnegie Mellon University
{alice,jian}@example.edu
Abstract
This work studies web interaction.
1 Introduction
The Robotics Institute benchmark is discussed in the body.
`;

    const institutions = extractInstitutionNamesFromText(text, ["Alice Chen", "Jian Wu"]);

    expect(institutions).toHaveLength(2);
    expect(institutions).toEqual(expect.arrayContaining(["Carnegie Mellon University", "Stanford University"]));
  });

  it("extracts authors, grouped emails, and institutions from full paper text", () => {
    const text = `
Embodied Planning Kernel
Jian Wu1, Sofia Garcia2
1 Department of Automation, Tsinghua University
2 Shanghai AI Laboratory
{jian,sofia}@example.edu

Abstract
This paper studies embodied planning.

1 Introduction
...

8 Appendix
Additional analysis.
`;

    const parsed = extractPaperDataFromText(text, []);

    expect(parsed.authors).toEqual(["Jian Wu", "Sofia Garcia"]);
    expect(parsed.emails).toEqual(["jian@example.edu", "sofia@example.edu"]);
    expect(parsed.institutionNamesRaw).toEqual(["Tsinghua University", "Shanghai AI Laboratory"]);
  });

  it("maps leading authors to their institutions from header markers", () => {
    const text = `
Embodied Planning Kernel
Jian Wu1, Sofia Garcia2, Alice Chen1
1 Department of Automation, Tsinghua University
2 Shanghai AI Laboratory

Abstract
This paper studies embodied planning.
`;

    expect(extractAuthorAffiliationsFromText(text, ["Jian Wu", "Sofia Garcia", "Alice Chen"])).toEqual([
      {
        author: "Jian Wu",
        institutions: ["Tsinghua University"],
      },
      {
        author: "Sofia Garcia",
        institutions: ["Shanghai AI Laboratory"],
      },
      {
        author: "Alice Chen",
        institutions: ["Tsinghua University"],
      },
    ]);
  });
});
