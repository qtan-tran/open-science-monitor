// RSS 2.0 / Atom / RDF feed parser and date handling tests.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseFeed, parseFeedDate } from "../scripts/pipeline/feeds.ts";
import { XmlParseError } from "../scripts/pipeline/xml.ts";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Core Funder News</title>
  <item>
    <title>cOAlition S publishes updated open access policy guidance</title>
    <link>https://example.org/plan-s-update</link>
    <pubDate>Wed, 18 Nov 2026 10:00:00 GMT</pubDate>
    <description>&lt;p&gt;New &lt;b&gt;open access&lt;/b&gt; policy guidance for grantees. Target: APC &lt; 1000 EUR.&lt;/p&gt;</description>
  </item>
  <item>
    <title>Item without a link uses its guid</title>
    <guid>https://example.org/guid-only</guid>
    <description>guid fallback</description>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Source</title>
  <entry>
    <title>Funder coalition extends rights retention policy to books</title>
    <link rel="self" href="https://example.org/feed-self" type="application/atom+xml"/>
    <link rel="alternate" href="https://example.org/rr-books"/>
    <id>urn:uuid:1234</id>
    <published>2026-11-17T08:00:00Z</published>
    <updated>2026-11-19T08:00:00Z</updated>
    <summary>Rights retention extended to books.</summary>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <item rdf:about="https://example.org/rdf-item">
    <title>Repository announces new deposit service</title>
    <link>https://example.org/rdf-item</link>
    <dc:date>2026-11-16</dc:date>
    <description>Green open access deposits.</description>
  </item>
</rdf:RDF>`;

test("parseFeedDate accepts RFC 822 and ISO 8601, rejects junk", () => {
  assert.equal(parseFeedDate("Wed, 18 Nov 2026 10:00:00 GMT"), "2026-11-18");
  assert.equal(parseFeedDate("2026-11-17T08:00:00Z"), "2026-11-17");
  assert.equal(parseFeedDate(""), null);
  assert.equal(parseFeedDate(null), null);
  assert.equal(parseFeedDate("not a date"), null);
});

test("parses RSS 2.0 items, strips HTML but keeps prose angle brackets, falls back to guid", () => {
  const items = parseFeed(RSS, "core-rss", "2026-11-20T07:30:00Z");
  assert.equal(items.length, 2);
  const first = items[0]!;
  assert.equal(first.title, "cOAlition S publishes updated open access policy guidance");
  assert.equal(first.url, "https://example.org/plan-s-update");
  assert.equal(first.published, "2026-11-18");
  assert.equal(first.summary, "New open access policy guidance for grantees. Target: APC < 1000 EUR.");
  const second = items[1]!;
  assert.equal(second.url, "https://example.org/guid-only");
  assert.equal(second.published, null); // missing pubDate handled explicitly
});

test("parses Atom entries with published AND updated, prefers alternate links", () => {
  const items = parseFeed(ATOM, "atom-src", "2026-11-20T07:30:00Z");
  assert.equal(items.length, 1);
  const entry = items[0]!;
  assert.equal(entry.url, "https://example.org/rr-books"); // not the rel="self" link
  assert.equal(entry.published, "2026-11-17");
  assert.equal(entry.updated, "2026-11-19");
});

test("parses RDF/RSS 1.0 items with namespaced dc:date", () => {
  const items = parseFeed(RDF, "rdf-src", "2026-11-20T07:30:00Z");
  assert.equal(items.length, 1);
  assert.equal(items[0]!.published, "2026-11-16");
  assert.equal(items[0]!.url, "https://example.org/rdf-item");
});

test("throws on malformed XML instead of returning garbage", () => {
  assert.throws(() => parseFeed("<rss><channel><it", "src", "now"), XmlParseError);
  assert.throws(() => parseFeed("this is not xml at all", "src", "now"), XmlParseError);
});

test("returns an empty list for a valid feed with no items", () => {
  const items = parseFeed(
    '<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>',
    "src",
    "now",
  );
  assert.deepEqual(items, []);
});
