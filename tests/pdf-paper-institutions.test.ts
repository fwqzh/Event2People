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

  it("still finds affiliations when two-column pdf text pushes them after abstract lines", () => {
    const text = `
Reducing Oracle Feedback with Vision-Language Embeddings for
Preference-Based RL
Udita Ghosh 1 ∗, Dripta S. Raychaudhuri 2, Jiachen Li 1, Konstantinos Karydis 1, Amit Roy-Chowdhury 1
Abstract — Preference-based reinforcement learning can learn
effective reward functions from comparisons.
I. INTRODUCTION
This is the first body section in the extracted order.
1 Univeristy of California, Riverside; 2 AWS AI Labs (Work done outside AWS)
* Corresponding author: ughos002@ucr.edu
II. RELATED WORK
...
`;

    expect(extractInstitutionNamesFromText(text, [
      "Udita Ghosh",
      "Dripta S. Raychaudhuri",
      "Jiachen Li",
      "Konstantinos Karydis",
      "Amit Roy-Chowdhury",
    ])).toEqual(["University of California, Riverside", "AWS AI Labs"]);

    expect(
      extractAuthorAffiliationsFromText(text, [
        "Udita Ghosh",
        "Dripta S. Raychaudhuri",
        "Jiachen Li",
      ]),
    ).toEqual([
      {
        author: "Udita Ghosh",
        institutions: ["University of California, Riverside"],
      },
      {
        author: "Dripta S. Raychaudhuri",
        institutions: ["AWS AI Labs"],
      },
      {
        author: "Jiachen Li",
        institutions: ["University of California, Riverside"],
      },
    ]);
  });
});
