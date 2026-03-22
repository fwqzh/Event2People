import { format, formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";

export function clampZh(text: string, limit: number) {
  const trimmed = text.replace(/\s+/g, " ").trim();

  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

export function clampPlainText(text: string, limit: number) {
  const trimmed = text.replace(/\s+/g, " ").trim();

  if (trimmed.length <= limit) {
    return trimmed;
  }

  const sliced = trimmed.slice(0, limit).trimEnd();
  const breakpoint = Math.max(
    sliced.lastIndexOf(" "),
    sliced.lastIndexOf("。"),
    sliced.lastIndexOf("，"),
    sliced.lastIndexOf("；"),
    sliced.lastIndexOf("、"),
    sliced.lastIndexOf("."),
    sliced.lastIndexOf(","),
    sliced.lastIndexOf(";"),
    sliced.lastIndexOf(":"),
  );

  if (breakpoint >= Math.floor(limit * 0.7)) {
    return sliced.slice(0, breakpoint).trimEnd();
  }

  return sliced;
}

export function sentenceZh(text: string, limit: number) {
  return clampZh(text.replace(/[。！？!?]+$/g, ""), limit);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function repoDisplayName(repoName: string) {
  const segments = repoName.split("/").filter(Boolean);
  return segments.at(-1) ?? repoName;
}

export function timeAgo(date: Date) {
  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: zhCN,
  });
}

export function formatDay(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function formatRefreshTime(date: Date) {
  return format(date, "MM-dd HH:mm");
}

export function compactInstitution(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value.replace(/^@/, "").replace(/\s+/g, " ").trim();
}

export function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter(Boolean).map((value) => value!.trim()).filter(Boolean))];
}
