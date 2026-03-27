import type { LinkItem } from "@/lib/types";

type PersonLinkSource = {
  githubUrl?: string | null;
  scholarUrl?: string | null;
  linkedinUrl?: string | null;
  xUrl?: string | null;
  homepageUrl?: string | null;
  email?: string | null;
  sourceUrls?: string[] | null;
};

const PERSON_LINK_BUILDERS = [
  { label: "Homepage", getUrl: (person: PersonLinkSource) => person.homepageUrl },
  { label: "GitHub", getUrl: (person: PersonLinkSource) => person.githubUrl },
  { label: "Scholar", getUrl: (person: PersonLinkSource) => person.scholarUrl },
  { label: "LinkedIn", getUrl: (person: PersonLinkSource) => person.linkedinUrl },
  { label: "X", getUrl: (person: PersonLinkSource) => person.xUrl },
  { label: "Email", getUrl: (person: PersonLinkSource) => (person.email ? `mailto:${person.email}` : null) },
] as const;

export function buildPersonLinks(person: PersonLinkSource): LinkItem[] {
  const directLinks: LinkItem[] = PERSON_LINK_BUILDERS.flatMap(({ label, getUrl }) => {
    const url = getUrl(person);
    return url ? [{ label, url }] : [];
  });

  if (directLinks.length > 0) {
    return directLinks;
  }

  return (person.sourceUrls ?? []).flatMap((url) =>
    url
      ? [
          {
            label: url.includes("github.com") ? "GitHub" : "外链",
            url,
          },
        ]
      : [],
  );
}
