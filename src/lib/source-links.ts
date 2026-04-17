import type { LinkItem } from "@/lib/types";

export const PREVIEW_IMAGE_SOURCE_LINK_LABEL = "__preview_image__";

function normalizeUrl(value: string | null | undefined) {
  const candidate = value?.trim() ?? "";

  if (!candidate) {
    return "";
  }

  try {
    const parsed = new URL(candidate);
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function appendPreviewImageSourceLink(sourceLinks: LinkItem[], previewImageUrl: string | null | undefined) {
  const visibleLinks = sourceLinks.filter((link) => link.label !== PREVIEW_IMAGE_SOURCE_LINK_LABEL);
  const normalizedPreviewImageUrl = normalizeUrl(previewImageUrl);

  if (!normalizedPreviewImageUrl) {
    return visibleLinks;
  }

  return [...visibleLinks, { label: PREVIEW_IMAGE_SOURCE_LINK_LABEL, url: normalizedPreviewImageUrl }];
}

export function getPreviewImageUrlFromSourceLinks(sourceLinks: LinkItem[], fallback?: string | null) {
  return sourceLinks.find((link) => link.label === PREVIEW_IMAGE_SOURCE_LINK_LABEL)?.url ?? fallback ?? null;
}

export function getVisibleSourceLinks(sourceLinks: LinkItem[]) {
  return sourceLinks.filter((link) => link.label !== PREVIEW_IMAGE_SOURCE_LINK_LABEL);
}
