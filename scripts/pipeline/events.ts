// Event registry: loading/saving data/events, and turning collected feed
// items into event records with dedupe + merging of duplicate coverage.

import * as fs from "node:fs";
import * as path from "node:path";

import type { Event, RawFeedItem, SourceSpec } from "../../shared/types.ts";
import { canonicalUrl, stableEventId, titleKey, titleTokens, tokenSimilarity, todayIso } from "./normalize.ts";
import { scoreCandidate } from "./score.ts";

export function loadRegistry(root: string): Map<string, Event> {
  const map = new Map<string, Event>();
  const dir = path.join(root, "data", "events");
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const ev = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Event;
    map.set(ev.id, ev);
  }
  return map;
}

export function saveEvent(root: string, ev: Event): void {
  const file = path.join(root, "data", "events", `${ev.id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sortKeys(ev), null, 2) + "\n", "utf8");
}

/** Deterministic key order so re-runs produce minimal diffs. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export interface MergedCandidate {
  event: Event; // for new events: the record to insert; for existing: the update
  isNew: boolean;
  isUpdate: boolean;
  primarySources: RawFeedItem[]; // feed items that point at this event
  relevance: number;
}

const DIR_MAP: Record<string, Event["doc_type"]> = {
  consultation: "consultation",
  study: "study",
  survey: "study",
  report: "report",
};

function guessDocType(title: string, summary: string): Event["doc_type"] {
  const text = `${title} ${summary}`.toLowerCase();
  for (const [needle, dt] of Object.entries(DIR_MAP)) {
    if (text.includes(needle)) return dt;
  }
  if (/launch|announc|opens|available|publish(?:es|ed)? (?:to|for)/i.test(title)) return "announcement";
  return "announcement";
}

function stubEditorialText(item: RawFeedItem, contributor: string): { what: string; why: string } {
  const summary = item.summary || item.title;
  const trim = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
  const what = `Pending editorial review. ${contributor} title: "${trim(item.title, 160)}". ${trim(summary, 280)} (Auto-stub; verify against the source before publishing.)`;
  const why = `Pending editorial review. Editorial relevance from ${contributor} not yet assessed. (Auto-stub; a human editor must write "Why it matters" grounded only in the source.)`;
  return { what, why };
}

/**
 * Group feed items that cover the same development:
 *   1. exact canonical-URL identity,
 *   2. exact normalised title match,
 *   3. fuzzy title match (Jaccard >= 0.75) across different feeds.
 * Merged coverage keeps every source of value as an additional source link.
 */
export function groupDuplicates(items: RawFeedItem[]): RawFeedItem[][] {
  const groups: { urls: Set<string>; titleKeys: Set<string>; items: RawFeedItem[] }[] = [];
  for (const item of items) {
    const cu = canonicalUrl(item.url);
    const tk = titleKey(item.title);
    let target: (typeof groups)[number] | undefined;
    for (const g of groups) {
      if (g.urls.has(cu)) {
        target = g;
        break;
      }
    }
    if (!target) {
      for (const g of groups) {
        if (g.titleKeys.has(tk) && tk !== "") {
          target = g;
          break;
        }
      }
    }
    if (!target) {
      const tokens = titleTokens(item.title);
      for (const g of groups) {
        const rep = g.items[0]!;
        if (tokenSimilarity(tokens, titleTokens(rep.title)) >= 0.75) {
          target = g;
          break;
        }
      }
    }
    if (!target) {
      target = { urls: new Set(), titleKeys: new Set(), items: [] };
      groups.push(target);
    }
    target.urls.add(cu);
    if (tk) target.titleKeys.add(tk);
    target.items.push(item);
  }
  return groups.map((g) => g.items);
}

/**
 * Turn collected feed items into event records, reusing existing registry
 * entries so a re-run never creates duplicate events or PRs.
 */
export function eventsFromFeedItems(
  root: string,
  items: RawFeedItem[],
  sourceById: Map<string, SourceSpec>,
  registry: Map<string, Event>,
  now: Date,
): { candidate: MergedCandidate; scored: ReturnType<typeof scoreCandidate> }[] {
  const out: { candidate: MergedCandidate; scored: ReturnType<typeof scoreCandidate> }[] = [];
  const discovered = todayIso(now);
  for (const group of groupDuplicates(items)) {
    // Deterministic group order: by source priority, then title.
    const sorted = [...group].sort((a, b) => a.title.localeCompare(b.title));
    const rep = sorted[0]!;
    const cu = canonicalUrl(rep.url);
    const id = stableEventId(rep.title, cu);
    const existing = registry.get(id);
    const sourceIds = sorted.map((i) => i.source_id);
    const primarySourceId =
      sourceIds.find((sid) => sourceById.get(sid)?.priority === "core") ?? sourceIds[0]!;
    const source = sourceById.get(primarySourceId);
    const allSourceRefs = sorted.map((i) => ({
      label: sourceById.get(i.source_id)?.name ?? i.source_id,
      url: i.url,
      source_id: i.source_id,
      kind: "primary" as const,
    }));
    const scored = scoreCandidate(
      rep.title,
      sorted.map((i) => i.summary).join(" "),
    );

    let published: string | null = null;
    for (const i of sorted) if (i.published) { published = i.published; break; }
    let updated: string | null = null;
    for (const i of sorted) if (i.updated || i.published) { updated = i.updated ?? i.published; break; }

    if (existing) {
      // Re-run: no duplicate record. Detect material updates only.
      const changed =
        (published !== null && published !== existing.dates.published) ||
        (updated !== null && updated !== existing.dates.updated) ||
        allSourceRefs.length > existing.sources.length;
      if (!changed) continue;
      const merged: Event = {
        ...existing,
        status: "updated",
        dates: {
          ...existing.dates,
          published: published ?? existing.dates.published,
          updated: updated ?? existing.dates.updated,
        },
        sources: mergeSources(existing.sources, allSourceRefs),
      };
      out.push({
        candidate: { event: merged, isNew: false, isUpdate: true, primarySources: sorted, relevance: scored.score },
        scored,
      });
      continue;
    }

    const { what, why } = stubEditorialText(rep, source?.name ?? rep.source_id);
    const ev: Event = {
      id,
      slug: id.replace(/^evt-/, ""),
      title: rep.title,
      organization: source?.name ?? rep.source_id,
      org_type: source?.kind ?? "unknown",
      region: source?.region ?? "Global",
      topics: (scored.topics.length > 0 ? scored.topics : ["oa-policy"]) as Event["topics"],
      doc_type: guessDocType(rep.title, rep.summary),
      status: "new",
      policy_id: null,
      dates: {
        published,
        updated: updated && updated !== published ? updated : null,
        effective: null,
        consultation_deadline: null,
        discovered,
      },
      sources: allSourceRefs,
      what_changed: what,
      why_it_matters: why,
      editorial_status: "pending",
      supersedes: null,
      merged_from: [],
      appearances: [],
      verified: false,
    };
    out.push({
      candidate: { event: ev, isNew: true, isUpdate: false, primarySources: sorted, relevance: scored.score },
      scored,
    });
  }
  return out;
}

export function mergeSources(
  existing: Event["sources"],
  additional: Event["sources"],
): Event["sources"] {
  const seen = new Set(existing.map((s) => canonicalUrl(s.url)));
  const out = [...existing];
  for (const s of additional) {
    const cu = canonicalUrl(s.url);
    if (!seen.has(cu)) {
      seen.add(cu);
      out.push(s);
    }
  }
  return out;
}
