import type { EventType, PeopleDetectionStatus, SourceType } from "@prisma/client";
import type { PaperExplanationView } from "@/lib/paper-copy";

export type EventTag =
  | "AI Agent"
  | "Coding Agent"
  | "Embodied AI"
  | "Robotics"
  | "Multimodal"
  | "Reasoning"
  | "Research Infra"
  | "Voice"
  | "Video"
  | "World Model"
  | "Open Source Infra"
  | "Other";

export type MetricItem = {
  label: string;
  value: string;
};

export type LinkItem = {
  label: string;
  url: string;
};

export type ReferenceItem = {
  label: string;
  title: string;
  url: string;
};

export type PersonInput = {
  stableId: string;
  name: string;
  identitySummaryZh: string;
  evidenceSummaryZh: string;
  sourceUrls: string[];
  githubUrl?: string | null;
  scholarUrl?: string | null;
  linkedinUrl?: string | null;
  xUrl?: string | null;
  homepageUrl?: string | null;
  email?: string | null;
  organizationNamesRaw?: string[];
  schoolNamesRaw?: string[];
  labNamesRaw?: string[];
  bioSnippetsRaw?: string[];
  founderHistoryRaw?: string[];
};

export type ProjectInput = {
  ownerType?: string | null;
  stableId: string;
  repoName: string;
  repoUrl: string;
  ownerName: string;
  ownerUrl: string;
  stars: number;
  starDelta7d: number;
  todayStars?: number | null;
  contributorsCount: number;
  repoCreatedAt: Date;
  repoUpdatedAt: Date;
  repoDescriptionRaw?: string | null;
  readmeExcerptRaw?: string | null;
  marketContextSnippetsRaw?: string[];
  marketContextLinks?: LinkItem[];
  githubContributors?: Array<{
    login: string;
    htmlUrl: string;
    type: string;
    contributions: number;
  }>;
  relatedPaperStableIds?: string[];
};

export type PaperInput = {
  stableId: string;
  paperTitle: string;
  paperUrl: string;
  authors: string[];
  authorsCount: number;
  publishedAt: Date;
  abstractRaw?: string | null;
  pdfTextRaw?: string | null;
  codeUrl?: string | null;
  semanticScholarUrl?: string | null;
  authorEmailsRaw?: string[];
  institutionNamesRaw?: string[];
  relatedProjectStableIds?: string[];
};

export type RepoPaperLinkInput = {
  projectStableId: string;
  paperStableId: string;
  evidenceType: string;
  evidenceSourceUrl: string;
  evidenceExcerpt: string;
  confidence: "confirmed" | "candidate";
};

export type EventInput = {
  stableId: string;
  sourceType: SourceType;
  eventType: EventType;
  eventTag: EventTag;
  eventTagConfidence: number;
  eventTitleZh: string;
  eventHighlightZh: string;
  eventDetailSummaryZh?: string | null;
  timePrimary: Date;
  metrics: MetricItem[];
  sourceLinks: LinkItem[];
  peopleDetectionStatus: PeopleDetectionStatus;
  projectStableIds: string[];
  paperStableIds: string[];
  personStableIds: string[];
  displayRank: number;
  relatedRepoCount?: number | null;
  relatedPaperCount?: number | null;
};

export type PipelineEntrySeedInput = {
  personStableId: string;
  savedAt: Date;
  savedFromEventStableId: string;
  savedFromEventTitle: string;
  recentActivitySummaryZh: string;
  copySummaryShortZh?: string;
  copySummaryFullZh?: string;
  status?: string | null;
  lastContactedAt?: Date | null;
  notes?: string | null;
};

export type DatasetBundleInput = {
  label: string;
  source: string;
  projects: ProjectInput[];
  papers: PaperInput[];
  people: PersonInput[];
  repoPaperLinks: RepoPaperLinkInput[];
  events: EventInput[];
  pipelineEntries?: PipelineEntrySeedInput[];
};

export type PersonView = PersonInput & {
  links: LinkItem[];
};

export type PersonPreviewView = {
  stableId: string;
  name: string;
  primaryLinkUrl: string | null;
};

export type EventSummaryView = EventInput & {
  timeAgo: string;
  cardTitle: string;
  previewPeople: PersonPreviewView[];
  peopleCount: number;
  isSaved: boolean;
  cardSummary: string;
  paperSummaryMetadata?: {
    publishedAtLabel: string;
    publishedAtTs: number;
    keywords: string[];
    topic: string;
  } | null;
};

export type EventDetailView = {
  stableId: string;
  people: Array<
    PersonView & {
      contributionCount: number;
    }
  >;
  sourceSummaryLabel: string;
  detailSummary: string;
  introSummary: string;
  analysisSummary?: string | null;
  analysisReferences?: ReferenceItem[];
  paperExplanation?: PaperExplanationView | null;
  paperMetadata?: {
    publishedAtLabel: string;
    authors: string[];
    authorEmails: string[];
    institutions: string[];
    leadAuthorAffiliations: Array<{
      author: string;
      institutions: string[];
    }>;
    keywords: string[];
    topic: string;
  } | null;
};

export type EventAnalysisView = {
  stableId: string;
  analysisSummary: string | null;
  analysisReferences: ReferenceItem[];
  paperExplanation?: PaperExplanationView | null;
};

export type PipelineEntryView = PipelineEntrySeedInput & {
  person: PersonView;
  timeAgo: string;
};
