import type { LinkItem, PersonView, PipelineEntryView } from "@/lib/types";

function formatLinks(links: LinkItem[]) {
  return links.map((link) => `${link.label}: ${link.url}`).join("\n");
}

function getPrimaryAffiliation(person: PersonView) {
  return person.organizationNamesRaw?.[0] ?? person.schoolNamesRaw?.[0] ?? person.labNamesRaw?.[0] ?? "";
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
    const contactLabels = entry.person.links.map((link) => link.label).join(" / ");
    const affiliation = getPrimaryAffiliation(entry.person);
    const featuredTitle = entry.featuredItem?.title ?? entry.savedFromEventTitle;

    return [
      `${index + 1}. ${entry.person.name}`,
      affiliation ? `- 身份：${affiliation}` : `- ${entry.person.identitySummaryZh}`,
      `- 项目/作品：${featuredTitle}`,
      entry.featuredItem?.introZh ? `- 简介：${entry.featuredItem.introZh}` : undefined,
      entry.featuredItem?.url ? `- 链接：${entry.featuredItem.url}` : undefined,
      contactLabels ? `- 联系方式：${contactLabels}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return ["本周 Pipeline", "", ...sections].join("\n");
}
