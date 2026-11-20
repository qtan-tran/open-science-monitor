// Feed collection with per-source error capture and injectable fetch.

import type { RawFeedItem, SourceFetchResult, SourceSpec } from "../../shared/types.ts";
import { parseFeed } from "./feeds.ts";
import { XmlParseError } from "./xml.ts";
import { nowIsoInstant } from "./normalize.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const USER_AGENT =
  "Mozilla/5.0 (compatible; OpenScienceMonitor/0.1; +https://github.com/qtan-tran/open-science-monitor)";

export class FeedFetchError extends Error {
  readonly sourceId: string;

  constructor(sourceId: string, message: string) {
    super(message);
    this.name = "FeedFetchError";
    this.sourceId = sourceId;
  }
}

/**
 * Collect one source feed. Never throws for per-source problems: failures
 * are returned in the result record so the run report can list them.
 */
export async function collectSource(
  source: SourceSpec,
  fetchFn: FetchLike = defaultFetch,
  timeoutMs = 20000,
): Promise<SourceFetchResult> {
  const base: SourceFetchResult = {
    id: source.id,
    ok: false,
    items: [],
  };
  if (!source.feed) {
    return { ...base, error: "no feed URL configured" };
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchFn(source.feed, {
        signal: ctl.signal,
        redirect: "follow",
        headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      });
      if (!res.ok) {
        return { ...base, error: `HTTP ${res.status} ${res.statusText}`.trim() };
      }
      const body = await res.text();
      if (!body.includes("<")) {
        return { ...base, error: "response is not XML" };
      }
      const items = parseFeed(body, source.id, nowIsoInstant());
      return { id: source.id, ok: true, items };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (e instanceof XmlParseError) {
      return { ...base, error: `malformed XML: ${e.message}` };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, error: `${e instanceof Error && e.name === "AbortError" ? "timeout" : "network"}: ${msg}` };
  }
}

/** Collect all feed sources concurrently (bounded). */
export async function collectAll(
  sources: SourceSpec[],
  fetchFn: FetchLike = defaultFetch,
  concurrency = 6,
): Promise<SourceFetchResult[]> {
  const feeds = sources.filter((s) => s.enabled && s.method !== "page");
  const out: SourceFetchResult[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < feeds.length) {
      const s = feeds[cursor++]!;
      out.push(await collectSource(s, fetchFn));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, feeds.length) }, worker));
  return out;
}

function defaultFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

export type { RawFeedItem };
