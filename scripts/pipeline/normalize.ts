// Normalisation: canonical URLs, stable event IDs, date handling.

/** Simple 32-bit FNV-1a hash as 8 hex chars (stable across runs). */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const TRACKING_PARAM_PREFIXES = ["utm_", "pk_", "mc_", "gclid", "fbclid", "ref", "ico-moderation"];
const TRACKING_PARAMS = ["spm", "cmpid", "socsrc", "s"];
const LOWERCASE_HOSTS = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

/**
 * Canonicalise a URL for identity (dedupe) purposes. Does NOT return the
 * reader-facing URL: the original URL is kept in source links; this is the
 * key two items are compared on.
 */
export function canonicalUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim().toLowerCase();
  }
  // HTTPS for identity comparison.
  if (url.protocol === "http:" && LOWERCASE_HOSTS.test(url.hostname)) {
    url.protocol = "https:";
  }
  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  const keep: [string, string][] = [];
  url.searchParams.forEach((v, k) => {
    const kk = k.toLowerCase();
    const drop =
      TRACKING_PARAM_PREFIXES.some((p) => kk.startsWith(p)) || TRACKING_PARAMS.includes(kk);
    if (!drop) keep.push([kk, v]);
  });
  keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  url.search = "";
  for (const [k, v] of keep) url.searchParams.append(k, v);
  // Collapse trailing slash (but keep "/" root).
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  url.pathname = path;
  return url.toString();
}

/** URL safe slug: keep [a-z0-9-]. */
export function slugify(s: string, maxWords = 0): string {
  const slug = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (maxWords > 0) {
    slug.split("-")
      .slice(0, maxWords)
      .join("-");
  }
  return maxWords > 0
    ? (slug.split("-").slice(0, maxWords).join("-") || "x")
    : (slug || "x");
}

const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "for", "to", "and", "or", "at", "by",
  "with", "from", "is", "are", "as", "its", "into", "new", "how", "s", "en",
]);

/** Normalised title token set (lowercase, alphanumeric only, no stopwords). */
export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .sort();
}

export function titleKey(title: string): string {
  return titleTokens(title).join(" ");
}

/** Jaccard similarity of two token lists. */
export function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Stable event ID derived from the canonical URL and title. The same
 * underlying document always maps to the same id across re-runs.
 */
export function stableEventId(title: string, canonical: string): string {
  const words = slugify(title, 0).split("-").filter(Boolean).slice(0, 6).join("-");
  return `evt-${words || "item"}-${fnv1a(canonical)}`;
}

export function todayIso(now?: Date): string {
  return (now ?? new Date()).toISOString().slice(0, 10);
}

export function nowIsoInstant(now?: Date): string {
  return (now ?? new Date()).toISOString();
}
