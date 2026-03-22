import { describe, expect, it } from "vitest";

import { buildGitHubCardSummaryZh, buildGitHubExpandedIntroZh, buildGitHubProjectIntroZh } from "@/lib/github-copy";

describe("buildGitHubCardSummaryZh", () => {
  it("builds a specific homepage summary instead of using a canned filler sentence", () => {
    const summary = buildGitHubCardSummaryZh({
      repoName: "openai/open-manu",
      repoDescriptionRaw: "browser automation loop",
      readmeExcerptRaw: "plan and execute browser tasks",
      highlight: "用于浏览器工作流的 agent 执行循环",
    });

    expect(summary).toContain("open-manu");
    expect(summary).toContain("用于浏览器工作流的 agent 执行循环");
    expect(summary).not.toContain("星标");
    expect(summary).not.toContain("贡献者");
    expect(summary).not.toContain("发起");
    expect(summary).not.toContain("相关人物");
    expect(summary).not.toContain("把相关能力组织成一套可直接运行的任务处理与执行流程");
    expect(summary).not.toContain("…");
    expect(summary).toContain("浏览器代理");
    expect(summary.endsWith("。")).toBe(true);
    expect(summary.length).toBeGreaterThanOrEqual(60);
    expect(summary.length).toBeLessThanOrEqual(80);
  });

  it("varies the capability clause by project keywords", () => {
    const browserSummary = buildGitHubCardSummaryZh({
      repoName: "rina/browserloop",
      repoDescriptionRaw: "Agent loop for browser-native workflows.",
      readmeExcerptRaw: "Tool-use runner for browser agents.",
      highlight: "用于浏览器工作流的 agent 执行循环",
    });

    const multimodalSummary = buildGitHubCardSummaryZh({
      repoName: "marvin/omnireason",
      repoDescriptionRaw: "Multimodal reasoning stack for frontier models.",
      readmeExcerptRaw: "Supports VLM planning, reasoning traces, and evaluation.",
      highlight: "用于多模态推理与规划的研究栈",
    });

    expect(browserSummary).toContain("浏览器代理");
    expect(multimodalSummary).toContain("多模态模型");
    expect(browserSummary).not.toEqual(multimodalSummary);
  });

  it("keeps the generic GitHub fallback intro free of ellipsis", () => {
    expect(buildGitHubProjectIntroZh({}, "Open Source Infra")).not.toContain("…");
  });

  it("builds an expanded intro that starts with the folded summary and then adds more detail", () => {
    const cardSummary = buildGitHubCardSummaryZh({
      repoName: "rina/browserloop",
      repoDescriptionRaw: "Agent loop for browser-native workflows.",
      readmeExcerptRaw: "Tool-use runner for browser agents.",
      highlight: "用于浏览器工作流的 agent 执行循环",
    });

    const introSummary = buildGitHubExpandedIntroZh({
      repoName: "rina/browserloop",
      repoDescriptionRaw: "Agent loop for browser-native workflows.",
      readmeExcerptRaw: "Tool-use runner for browser agents.",
      highlight: "用于浏览器工作流的 agent 执行循环",
      cardSummary,
    });

    expect(introSummary.startsWith(cardSummary)).toBe(true);
    expect(introSummary.length).toBeGreaterThan(cardSummary.length + 20);
    expect(introSummary).toContain("页面观察");
    expect(introSummary).toContain("读取网页状态");
    expect(introSummary.endsWith("。")).toBe(true);
  });
});
