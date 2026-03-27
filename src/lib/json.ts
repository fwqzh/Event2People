import type { LinkItem, MetricItem } from "@/lib/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => cleanString(item)).filter(Boolean);
}

export function readMetricItems(value: unknown): MetricItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const label = cleanString(item.label);
    const metricValue = cleanString(item.value);

    if (!label || !metricValue) {
      return [];
    }

    return [{ label, value: metricValue }];
  });
}

export function readLinkItems(value: unknown): LinkItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const label = cleanString(item.label);
    const url = cleanString(item.url);

    if (!label || !url) {
      return [];
    }

    return [{ label, url }];
  });
}
