import { compactInstitution, slugify } from "@/lib/text";
import type { PersonInput } from "@/lib/types";

function normalizeUrl(url?: string | null) {
  if (!url) {
    return "";
  }

  return url.replace(/\/+$/g, "").toLowerCase();
}

function topInstitution(person: PersonInput) {
  return compactInstitution(person.organizationNamesRaw?.[0] ?? person.schoolNamesRaw?.[0] ?? person.labNamesRaw?.[0] ?? "");
}

export function shouldMergePeople(left: PersonInput, right: PersonInput) {
  const directUrlFields: Array<keyof PersonInput> = ["githubUrl", "scholarUrl", "linkedinUrl"];

  for (const field of directUrlFields) {
    const leftUrl = normalizeUrl((left[field] as string | null | undefined) ?? null);
    const rightUrl = normalizeUrl((right[field] as string | null | undefined) ?? null);

    if (leftUrl && rightUrl && leftUrl === rightUrl) {
      return { shouldMerge: true, reason: `${field} 完全一致` };
    }
  }

  const leftName = slugify(left.name);
  const rightName = slugify(right.name);
  const leftInstitution = slugify(topInstitution(left));
  const rightInstitution = slugify(topInstitution(right));

  if (leftName && rightName && leftName === rightName && leftInstitution && rightInstitution && leftInstitution === rightInstitution) {
    return { shouldMerge: true, reason: "name + institution 高置信匹配" };
  }

  return { shouldMerge: false, reason: "低置信匹配，保留为独立候选" };
}
