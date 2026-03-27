import { describe, expect, it } from "vitest";

import { extractInstitutionNamesFromText } from "@/lib/pdf-paper-institutions";

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
});
