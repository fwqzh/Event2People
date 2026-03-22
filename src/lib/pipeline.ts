import type { PersonView } from "@/lib/types";

export function buildRecentActivitySummary(options: {
  repoName?: string | null;
  starDelta7d?: number | null;
  paperTitle?: string | null;
  hasCode?: boolean;
}) {
  if (options.repoName && typeof options.starDelta7d === "number") {
    return `最近活动：创建 ${options.repoName}，近 7 天 +${options.starDelta7d} stars`;
  }

  if (options.paperTitle && options.hasCode) {
    return `最近活动：关联的 Paper “${options.paperTitle}” 已附代码`;
  }

  if (options.paperTitle) {
    return `最近活动：关联的新 paper 为 “${options.paperTitle}”`;
  }

  return "最近活动：近期仍出现在相关事件中";
}

export function buildCopySummaries(person: PersonView, sourceTitle: string, recentActivitySummaryZh: string) {
  const lines = [
    person.name,
    `- ${person.identitySummaryZh}`,
    `- 来源事件：${sourceTitle}`,
    `- 证据：${person.evidenceSummaryZh}`,
    `- ${recentActivitySummaryZh}`,
    ...person.links.map((link) => `- ${link.label}: ${link.url}`),
  ];

  return {
    short: lines.join("\n"),
    full: lines.join("\n"),
  };
}
