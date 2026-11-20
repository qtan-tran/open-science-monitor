// Minimal streaming-free XML parser producing a generic element tree.
// Deliberately small: only what RSS 2.0 / Atom feeds need. Namespaces are
// ignored (prefixed tags are stored by local name, e.g. dc:date -> date).

export interface XmlElement {
  tag: string; // local name, lowercase, namespace prefix stripped
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string; // concatenated character data of this element
}

export class XmlParseError extends Error {}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function localName(tag: string): string {
  const i = tag.indexOf(":");
  return (i === -1 ? tag : tag.slice(i + 1)).toLowerCase();
}

/** Parse an XML document string. Throws XmlParseError on malformed input. */
export function parseXml(xml: string): XmlElement {
  // Strip XML declaration, doctype, comments, processing instructions.
  let text = xml
    .replace(/^\s*<\?[\s\S]*?\?>\s*/, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "");

  const root: XmlElement = { tag: "#doc", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  let i = 0;

  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt === -1) break;
    if (lt > i) {
      stack.at(-1)!.text += decodeEntities(text.slice(i, lt));
    }
    // CDATA
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt);
      if (end === -1) throw new XmlParseError("unterminated CDATA");
      stack.at(-1)!.text += text.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    const gt = text.indexOf(">", lt);
    if (gt === -1) throw new XmlParseError("unterminated tag");
    const rawTag = text.slice(lt + 1, gt);
    if (rawTag.startsWith("/")) {
      // Closing tag.
      const tag = localName(rawTag.slice(1).trim());
      // Pop until matching tag (tolerant of mismatched wrappers).
      for (let d = stack.length - 1; d > 0; d--) {
        if (stack[d]!.tag === tag) {
          stack.length = d;
          break;
        }
      }
      i = gt + 1;
      continue;
    }
    const selfClosing = rawTag.endsWith("/");
    const inner = selfClosing ? rawTag.slice(0, -1) : rawTag;
    const m = /^([^\s/]+)([\s\S]*)$/.exec(inner.trim());
    if (!m) throw new XmlParseError(`empty tag at offset ${lt}`);
    const attrs: Record<string, string> = {};
    const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(m[2] ?? "")) !== null) {
      attrs[localName(am[1]!)] = decodeEntities(am[2] ?? am[3] ?? "");
    }
    const el: XmlElement = { tag: localName(m[1]!), attrs, children: [], text: "" };
    stack.at(-1)!.children.push(el);
    if (!selfClosing) stack.push(el);
    i = gt + 1;
  }
  if (root.children.length === 0) throw new XmlParseError("no elements found");
  return root;
}

/** First child with the given local tag (or null). */
export function child(el: XmlElement, tag: string): XmlElement | null {
  return el.children.find((c) => c.tag === tag.toLowerCase()) ?? null;
}

/** All children with the given local tag. */
export function children(el: XmlElement, tag: string): XmlElement[] {
  return el.children.filter((c) => c.tag === tag.toLowerCase());
}

/**
 * Strip HTML from a text run (feed summaries arrive as HTML fragments),
 * collapse whitespace, decode entities (already done by the parser).
 */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      // Only strip well-formed-looking tags ("<x ...>"); a "<" followed by a
      // space is prose, not markup, so keep it (e.g. "APC < 1000 EUR").
      .replace(/<\/?[a-zA-Z][^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}
