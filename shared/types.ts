// Shared data model for the Open Science Monitor.
//
// Design goal: sources, events (developments), policies/initiatives and
// issues (weekly briefs) are modelled separately and linked through stable
// IDs, so one event can appear in many views (issue pages, archive,
// policy tracker) while pointing to a single record on disk.

// ---------------------------------------------------------------------------
// Taxonomies (keep in sync with schemas/*.schema.json)
// ---------------------------------------------------------------------------

export const TOPICS = [
  "oa-policy",
  "funder-mandates",
  "consultations",
  "diamond-oa",
  "apc-bpc",
  "transformative-agreements",
  "business-models",
  "repositories",
  "rights-retention",
  "licensing",
  "research-data",
  "research-assessment",
  "equity",
  "multilingualism",
  "indigenous-data",
  "infrastructure",
  "research-evidence",
] as const;
export type Topic = (typeof TOPICS)[number];

export const REGIONS = [
  "Europe",
  "North America",
  "Latin America & Caribbean",
  "Africa",
  "Asia Pacific",
  "Global",
] as const;
export type Region = (typeof REGIONS)[number];

export const DOC_TYPES = [
  "policy",
  "guidance",
  "consultation",
  "report",
  "study",
  "analysis",
  "position",
  "announcement",
  "materials",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const SOURCE_KINDS = [
  "primary",
  "secondary",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

// Pipeline event status: "new" = first time seen, "updated" = a previously
// registered event with a material change in this window.
export const EVENT_STATUSES = ["new", "updated"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export type EditorialStatus = "pending" | "edited";

// ---------------------------------------------------------------------------
// Sources (config/sources.yml)
// ---------------------------------------------------------------------------

export type SourceMethod = "rss" | "atom" | "page";

export interface SourceSpec {
  id: string;
  name: string;
  url: string;
  kind: string;
  region: Region;
  language: string;
  method: SourceMethod;
  feed?: string;
  enabled: boolean;
  priority: "core" | "supplementary";
  notes: string;
}

export interface SourcesFile {
  coverage: {
    scope: string;
    gaps: string[];
    as_of: string;
    how_to_add: string;
  };
  sources: SourceSpec[];
}

// ---------------------------------------------------------------------------
// Events (data/events/<id>.json)
// ---------------------------------------------------------------------------

export interface EventDateSet {
  // Best-known publication date of the underlying document (ISO date or null).
  published: string | null;
  // Best-known material-update date of the document (ISO date or null).
  updated: string | null;
  // Date a policy takes effect (ISO date or null).
  effective: string | null;
  // Consultation response deadline (ISO date or null).
  consultation_deadline: string | null;
  // When our pipeline first recorded this event (always set). If no other
  // date is known, this is the only date and the rendered item must say so.
  discovered: string;
}

export interface EventSourceRef {
  label: string;
  url: string;
  source_id?: string;
  kind: SourceKind;
}

export interface Event {
  id: string;
  slug: string;
  title: string;
  organization: string;
  org_type: string;
  region: Region;
  country?: string | null;
  topics: Topic[];
  doc_type: DocType;
  status: EventStatus;
  policy_id: string | null;
  dates: EventDateSet;
  sources: EventSourceRef[];
  what_changed: string;
  why_it_matters: string;
  editorial_status: EditorialStatus;
  // Cross-referencing between event records.
  supersedes?: string | null;
  merged_from?: string[];
  // Issues (by week id) in which this event has appeared.
  appearances: string[];
  // True when a human editor verified claims against sources.
  verified: boolean;
  sample?: boolean;
  llm_suggestions?: {
    model?: string;
    topics?: string[];
    what_changed?: string;
    why_it_matters?: string;
  };
  note?: string | null;
}

// ---------------------------------------------------------------------------
// Policies / initiatives (data/policies/<id>.json)
// ---------------------------------------------------------------------------

export type MilestoneStatus =
  | "draft"
  | "consultation"
  | "adopted"
  | "in force"
  | "revised"
  | "operational";

export interface PolicyMilestone {
  status: MilestoneStatus;
  date: string | null; // ISO date; null = date unknown/unverified
  label: string;
  source?: string;
  verified: boolean;
}

export interface Policy {
  id: string;
  name: string;
  organization: string;
  region: Region;
  type: "policy" | "initiative" | "program" | "platform";
  description: string;
  milestones: PolicyMilestone[];
  // false = milestones not yet human-verified; the site must label this.
  verified: boolean;
  sample?: boolean;
}

// ---------------------------------------------------------------------------
// Issues (data/issues/<week>.json)
// ---------------------------------------------------------------------------

export interface IssueSourceRunRecord {
  id: string;
  ok: boolean;
  new_candidates?: number;
  error?: string;
}

export interface IssueRunReport {
  cutoff: string; // ISO instant the window closes (Fri 08:30 Europe/Berlin)
  horizon_from: string | null; // ISO instant the window opens
  sources_checked: number;
  sources_failed: number;
  failures: { id: string; error: string }[];
  sources: IssueSourceRunRecord[];
  notes: string[];
  // Checked but not shortlisted: real outcome, honest record.
  not_shortlisted?: { title: string; reason: string }[];
  llm_assisted: boolean;
}

export interface Issue {
  id: string; // ISO week, e.g. "2026-W47"
  week_start: string; // Monday, ISO date
  generated_at: string; // ISO instant (run time)
  status: "sample" | "draft" | "published";
  summary: string;
  signal: string;
  headline_event: string | null;
  items: string[]; // event IDs, in editorial order
  counts: {
    items: number;
    candidates?: number;
    sources_checked?: number;
    sources_failed?: number;
  };
  run_report?: IssueRunReport;
  paths: {
    markdown: string;
    html: string;
    substack: string;
  };
  sample?: boolean;
}

// ---------------------------------------------------------------------------
// Feed items (collector output, normalised)
// ---------------------------------------------------------------------------

export interface RawFeedItem {
  source_id: string;
  title: string;
  url: string;
  published: string | null; // ISO date when parseable
  updated: string | null;
  summary: string;
  fetched_at: string; // ISO instant
}

export interface SourceFetchResult {
  id: string;
  ok: boolean;
  items: RawFeedItem[];
  error?: string;
}
