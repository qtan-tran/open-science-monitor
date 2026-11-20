// URL canonicalisation, stable IDs, title tokens and dedupe grouping tests.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalUrl,
  fnv1a,
  slugify,
  stableEventId,
  titleKey,
  titleTokens,
  tokenSimilarity,
} from "../scripts/pipeline/normalize.ts";
import { groupDuplicates } from "../scripts/pipeline/events.ts";
import type { RawFeedItem } from "../shared/types.ts";

test("canonicalUrl: lowercases the host, drops the hash and trailing slash", () => {
  assert.equal(canonicalUrl("https://Example.com/News/"), "https://example.com/News");
  assert.equal(canonicalUrl("https://example.org/page#section"), "https://example.org/page");
  assert.equal(canonicalUrl("https://example.org/"), "https://example.org/");
  assert.equal(canonicalUrl("https://example.org/a/b/"), "https://example.org/a/b");
});

test("canonicalUrl: strips tracking parameters but keeps meaningful ones", () => {
  assert.equal(
    canonicalUrl("https://example.org/p?utm_source=rss&fbclid=abc&id=7"),
    "https://example.org/p?id=7",
  );
  assert.equal(canonicalUrl("https://example.org/p?mc_cid=1&pk_campaign=2"), "https://example.org/p");
  assert.equal(canonicalUrl("https://example.org/p?lang=de&doc=2"), "https://example.org/p?doc=2&lang=de");
});

test("canonicalUrl: the same URL with different tracking params is one identity", () => {
  const a = canonicalUrl("https://example.org/rr-books?utm_source=rss&utm_medium=feed");
  const b = canonicalUrl("https://example.org/rr-books/");
  assert.equal(a, b);
});

test("canonicalUrl: upgrades plain http to https for identity comparison", () => {
  assert.equal(canonicalUrl("http://example.org/a"), "https://example.org/a");
});

test("canonicalUrl: garbage input degrades to a trimmed lowercase string", () => {
  assert.equal(canonicalUrl("  Not A URL "), "not a url");
});

test("fnv1a and stableEventId are deterministic across runs", () => {
  assert.equal(fnv1a("https://example.org/x"), fnv1a("https://example.org/x"));
  assert.equal(fnv1a("a"), fnv1a("a"));
  assert.notEqual(fnv1a("a"), fnv1a("b"));
  const id1 = stableEventId("Rights Retention Extended", "https://example.org/rr");
  const id2 = stableEventId("Rights Retention Extended", "https://example.org/rr");
  const id3 = stableEventId("Rights Retention Extended", "https://example.org/other");
  assert.equal(id1, id2, "same document -> same id on re-runs");
  assert.notEqual(id1, id3, "different document -> different id");
  assert.match(id1, /^evt-[a-z0-9-]+-[0-9a-f]{8}$/);
});

test("slugify keeps [a-z0-9-] and folds diacritics", () => {
  assert.equal(slugify("Ünïcödé  Tïtés — for Journals!"), "unicode-tites-for-journals");
  assert.equal(slugify("  "), "x");
});

test("titleTokens removes stopwords and punctuation", () => {
  assert.deepEqual(titleTokens("The Rights Retention Strategy and Open Access"), [
    "access",
    "open",
    "retention",
    "rights",
    "strategy",
  ]);
  assert.equal(titleKey("COALITION S Updates!"), coalitionKey());
  function coalitionKey(): string {
    return titleKey("coalition s updates");
  }
});

test("tokenSimilarity: identical 1, disjoint 0, partial exact Jaccard", () => {
  assert.equal(tokenSimilarity(["a", "b"], ["a", "b"]), 1);
  assert.equal(tokenSimilarity(["a"], ["b"]), 0);
  assert.equal(tokenSimilarity(["a", "b", "c"], ["a", "b", "d"]), 0.5);
});

test("groupDuplicates: same canonical URL with tracking noise merges", () => {
  const items: RawFeedItem[] = [
    mk("src-a", "Coalition S updates rights retention", "https://example.org/rr?utm_source=feed"),
    mk("src-b", "Totally different headline, same document", "https://example.org/rr/"),
  ];
  const groups = groupDuplicates(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.length, 2, "both sources kept as coverage of one event");
});

test("groupDuplicates: same normalised title, different URL merges", () => {
  const items: RawFeedItem[] = [
    mk("src-a", "Funder coalition extends rights retention policy to books", "https://a.example.org/rr"),
    mk("src-b", "Funder coalition extends rights retention policy to books!", "https://b.example.org/news"),
  ];
  const groups = groupDuplicates(items);
  assert.equal(groups.length, 1);
});

test("groupDuplicates: fuzzy title match merges cross-feed echoes, unrelated stay apart", () => {
  const echo = "cOAlition S publishes updated open access policy guidance for grantees";
  const groups = groupDuplicates([
    mk("coalition-s", echo, "https://coalition-s.example/plan-s-update"),
    mk("ukri", "cOAlition S publishes updated open access policy guidance", "https://ukri.example/news/x"),
    mk("scielo", "SciELO announces a new collection of Brazilian OA journals", "https://scielo.example/c"),
  ]);
  assert.equal(groups.length, 2, "two echoes merge; the unrelated item stays separate");
});

function mk(sourceId: string, title: string, url: string): RawFeedItem {
  return {
    source_id: sourceId,
    title,
    url,
    published: "2026-11-18",
    updated: null,
    summary: "test summary",
    fetched_at: "2026-11-20T07:30:00.000Z",
  };
}
