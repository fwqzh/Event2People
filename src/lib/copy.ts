import type { LinkItem, PersonView, PipelineEntryView } from "@/lib/types";

function formatLinks(links: LinkItem[]) {
  return links.map((link) => `${link.label}: ${link.url}`).join("\n");
}

export function buildPersonCopySummary(person: PersonView, sourceTitle: string, recentActivitySummaryZh: string) {
  const lines = [
    person.name,
    `- ${person.identitySummaryZh}`,
    `- 来源事件：${sourceTitle}`,
    `- 证据：${person.evidenceSummaryZh}`,
    `- 最近活动：${recentActivitySummaryZh}`,
  ];

  if (person.links.length > 0) {
    lines.push(formatLinks(person.links));
  }

  return lines.join("\n");
}

export function buildPipelinePageCopy(entries: PipelineEntryView[]) {
  const sections = entries.map((entry, index) => {
    const compactLinks = entry.person.links.map((link) => link.label).join(" / ");

    return [
      `${index + 1}. ${entry.person.name}`,
      `- ${entry.person.identitySummaryZh}`,
      `- 来源：${entry.savedFromEventTitle}`,
      `- 最近活动：${entry.recentActivitySummaryZh}`,
      compactLinks ? `- 链接：${compactLinks}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return ["本周 Pipeline", "", ...sections].join("\n");
}
