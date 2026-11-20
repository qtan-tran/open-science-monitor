// Archive filter state <-> URL query parameter serialisation.
// Used by the static site generator, the client-side archive script, and
// tests. Keeping it here means URL filters behave identically everywhere.

export interface FilterState {
  q: string; // free text
  topic: string; // one of topic taxonomy or ""
  region: string;
  organization: string;
  docType: string;
  week: string; // e.g. "2026-W47" or ""
}

export const FILTER_KEYS: (keyof FilterState)[] = [
  "q",
  "topic",
  "region",
  "organization",
  "docType",
  "week",
];

export function emptyFilterState(): FilterState {
  return { q: "", topic: "", region: "", organization: "", docType: "", week: "" };
}

/** Parse a URL query string (with or without "?") into filter state. */
export function parseFiltersFromQuery(query: string): FilterState {
  const state = emptyFilterState();
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  state.q = (params.get("q") ?? "").trim().slice(0, 200);
  state.topic = params.get("topic") ?? "";
  state.region = params.get("region") ?? "";
  state.organization = params.get("org") ?? "";
  state.docType = params.get("type") ?? "";
  state.week = params.get("week") ?? "";
  return state;
}

/** Serialise filter state into a query string ("?q=..." or "?"). */
export function filtersToQuery(state: FilterState): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.topic) params.set("topic", state.topic);
  if (state.region) params.set("region", state.region);
  if (state.organization) params.set("org", state.organization);
  if (state.docType) params.set("type", state.docType);
  if (state.week) params.set("week", state.week);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function filterStateIsDefault(state: FilterState): boolean {
  const d = emptyFilterState();
  return FILTER_KEYS.every(
    (k) => state[k as keyof FilterState] === d[k as keyof FilterState],
  );
}

export interface ArchiveItemText {
  title: string;
  organization: string;
  region: string;
  topics: string[];
  docType: string;
  week: string;
  body: string; // what_changed + why_it_matters, pre-joined
}

/** Normalised text for full-text matching (case-insensitive substring). */
function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}

export function itemMatchesFilters(
  item: ArchiveItemText,
  state: FilterState,
): boolean {
  if (state.topic && !item.topics.includes(state.topic)) return false;
  if (state.region && item.region !== state.region) return false;
  if (state.docType && item.docType !== state.docType) return false;
  if (state.organization) {
    const want = norm(state.organization);
    if (!norm(item.organization).includes(want)) return false;
  }
  if (state.week && item.week !== state.week) return false;
  if (state.q) {
    // All query terms must appear somewhere (AND across words).
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    const haystack = norm(
      [item.title, item.organization, item.region, item.topics.join(" "), item.docType, item.week, item.body].join(" "),
    );
    if (!terms.every((t) => haystack.includes(t))) return false;
  }
  return true;
}
