import { describe, expect, it } from "vitest";

import { buildPaperExplanationZh, buildPaperTopicView } from "@/lib/paper-copy";

describe("paper Chinese explanation", () => {
  it("builds a planning-oriented explanation from the title and abstract", () => {
    const result = buildPaperExplanationZh({
      paperTitle: "Embodied Planning Kernel",
      abstractRaw: "Planning primitives for embodied agents in cluttered scenes.",
      eventTag: "Robotics",
      hasCode: false,
      relatedRepoCount: 0,
    });

    expect(result.lead).toContain("复杂任务规划");
    expect(result.problem).toContain("决策链路长");
    expect(result.method).toContain("规划内核与决策原语");
    expect(result.contribution).toContain("研究切口");
  });

  it("mentions public code when the paper already has an implementation entry", () => {
    const result = buildPaperExplanationZh({
      paperTitle: "Robot Web Pilot",
      abstractRaw: "Embodied web interaction policy for robotics operators.",
      eventTag: "Embodied AI",
      hasCode: true,
      relatedRepoCount: 1,
    });

    expect(result.problem).toContain("网页交互");
    expect(result.method).toContain("执行策略");
    expect(result.contribution).toContain("已有代码入口");
  });

  it("does not misclassify ordinary evaluation wording as a benchmark paper", () => {
    const result = buildPaperExplanationZh({
      paperTitle: "PhotoAgent: A Robotic Photographer with Spatial and Aesthetic Understanding",
      abstractRaw:
        "We introduce PhotoAgent for robotic photography and evaluate it across diverse real-world scenes with a multimodal controller.",
      eventTag: "Embodied AI",
      hasCode: false,
      relatedRepoCount: 0,
    });

    expect(result.problem).not.toContain("任务定义分散");
    expect(result.method).toContain("PhotoAgent");
  });

  it("keeps different robotics papers from collapsing into the same explanation copy", () => {
    const photoAgent = buildPaperExplanationZh({
      paperTitle: "PhotoAgent: A Robotic Photographer with Spatial and Aesthetic Understanding",
      abstractRaw:
        "We introduce PhotoAgent for robotic photography and evaluate it across diverse real-world scenes with a multimodal controller.",
      eventTag: "Embodied AI",
      hasCode: false,
      relatedRepoCount: 0,
    });
    const uniDex = buildPaperExplanationZh({
      paperTitle: "UniDex: A Robot Foundation Suite for Universal Dexterous Hand Control from Egocentric Human Videos",
      abstractRaw:
        "We present UniDex, a robot foundation suite that couples a large-scale robot-centric dataset with a unified vision-language-action policy for universal dexterous hand control.",
      eventTag: "Robotics",
      hasCode: false,
      relatedRepoCount: 0,
    });

    expect(photoAgent.method).toContain("PhotoAgent");
    expect(uniDex.method).toContain("UniDex");
    expect([photoAgent.problem, photoAgent.method, photoAgent.contribution].join("\n")).not.toBe(
      [uniDex.problem, uniDex.method, uniDex.contribution].join("\n"),
    );
  });

  it("still recognizes explicit benchmark or dataset papers", () => {
    const result = buildPaperExplanationZh({
      paperTitle: "Embodied Web Benchmark Dataset",
      abstractRaw:
        "We release a new benchmark dataset and evaluation suite for embodied web agents with unified tasks and metrics.",
      eventTag: "Research Infra",
      hasCode: false,
      relatedRepoCount: 0,
    });

    expect(result.problem).toContain("任务定义分散");
    expect(result.method).toContain("评测基准与任务定义");
  });

  it("derives a topic and keywords for display", () => {
    const result = buildPaperTopicView({
      paperTitle: "Embodied Planning Kernel",
      abstractRaw: "Planning primitives for embodied agents in cluttered scenes.",
      eventTag: "Robotics",
    });

    expect(result.topic).toBe("复杂任务规划");
    expect(result.keywords).toContain("复杂任务规划");
    expect(result.keywords).toContain("规划内核与决策原语");
  });
});
