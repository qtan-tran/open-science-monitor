// RSS 2.0 / Atom / RDF-RSS feed parsing into normalised raw feed items.

import type { RawFeedItem } from "../../shared/types.ts";
import { child, children, parseXml, stripHtml, XmlParseError, type XmlElement } from "./xml.ts";

/** Parse a date string of the common feed formats to an ISO date (yyyy-mm-dd). */
export function parseFeedDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (t === "") return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function textOf(el: XmlElement | null): string {
  return el ? el.text.trim() : "";
}

/**
 * Parse a feed document. Detects RSS 2.0 (<rss>), Atom (<feed>) and
 * RDF/RSS 1.0. Returns [] when the document parses but contains no items,
 * and throws XmlParseError for malformed XML.
 */
export function parseFeed(xml: string, sourceId: string, fetchedAt: string): RawFeedItem[] {
  const doc = parseXml(xml);
  const items: RawFeedItem[] = [];

  const rssRoot = child(doc, "rss");
  const rdfRoot = child(doc, "rdf");
  const atomRoot = child(doc, "feed");

  const mk = (
    title: string,
    url: string,
    published: string | null,
    updated: string | null,
    summary: string,
  ): RawFeedItem => ({
    source_id: sourceId,
    title: title || "(untitled)",
    url: url || "",
    published,
    updated,
    summary: summary.slice(0, 2000),
    fetched_at: fetchedAt,
  });

  if (rssRoot) {
    const channel = child(rssRoot, "channel")!;
    for (const it of children(channel, "item").concat(children(rssRoot, "item"))) {
      items.push(
        mk(
          stripHtml(textOf(child(it, "title"))),
          (textOf(child(it, "link")) || child(it, "guid")?.text.trim() || "").trim(),
          parseFeedDate(textOf(child(it, "pubdate")) || textOf(child(it, "date"))),
          null,
          stripHtml(textOf(child(it, "description")) || textOf(child(it, "summary"))),
        ),
      );
    }
  } else if (atomRoot) {
    for (const it of children(atomRoot, "entry")) {
      const links = children(it, "link");
      const alt =
        links.find((l) => (l.attrs["rel"] ?? "alternate") === "alternate") ?? links[0] ?? null;
      items.push(
        mk(
          stripHtml(textOf(child(it, "title"))),
          alt?.attrs["href"] ?? textOf(child(it, "id")),
          parseFeedDate(textOf(child(it, "published"))),
          parseFeedDate(textOf(child(it, "updated"))),
          stripHtml(textOf(child(it, "summary")) || textOf(child(it, "content"))),
        ),
      );
    }
  } else if (rdfRoot) {
    for (const it of children(rdfRoot, "item")) {
      items.push(
        mk(
          stripHtml(textOf(child(it, "title"))),
          (child(it, "link")?.attrs["about"] || textOf(child(it, "link"))).trim(),
          parseFeedDate(textOf(child(it, "date"))),
          null,
          stripHtml(textOf(child(it, "description"))),
        ),
      );
    }
  }

  return items.filter((it) => it.url !== "" || it.title !== "(untitled)");
}
