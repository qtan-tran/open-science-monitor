// Static site generator (no build tooling beyond Node itself).
//
// Reads: config/site.yml, config/sources.yml, data/{issues,events,policies},
// data/source-status.json, and the rendered issues/ folder.
// Writes: dist/ (fully static; deployable to GitHub Pages or any host).
//
// The presentation layer is intentionally isolated: it consumes the same
// validated JSON datasets as the newsletter renderers and could be
// replaced (e.g. by an Astro app) without touching collection or rendering.

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import type { Event, Issue, Policy } from "../shared/types.ts";
import { dateRangeOf, dateLabels, esc } from "./pipeline/render.ts";
import { loadEvents, loadIssues, loadPolicies, loadSiteConfig, loadSourceStatus, loadSources, REPO_ROOT, rootFromArg } from "./lib/data.ts";

// Build a version tag for the static assets: browsers cache styles.css for a
// while (GitHub Pages sends max-age=600), so every design change must ship a
// NEW asset URL, or returning visitors keep seeing the previous stylesheet.
// The tag is the content hash of the stylesheet, so it only changes when the
// file actually changes.
let ASSET_VER = "";
function computeAssetVersion(root: string): void {
  try {
    const css = fs.readFileSync(path.join(root, "site", "assets", "styles.css"));
    ASSET_VER = createHash("sha256").update(css).digest("hex").slice(0, 10);
  } catch {
    ASSET_VER = ""; // e.g. synthetic roots without the real assets
  }
}
function assetUrl(rel: string): string {
  return ASSET_VER ? `${rel}?v=${ASSET_VER}` : rel;
}

// ---------------------------------------------------------------------------
// Small template helpers
// ---------------------------------------------------------------------------

const STATUS_CHIP: Record<string, string> = {
  draft: "draft",
  consultation: "consultation",
  adopted: "adopted",
  "in force": "in force",
  revised: "revised",
  operational: "operational",
};

function chip(text: string, cls = ""): string {
  return `<span class="chip ${cls}">${esc(text)}</span>`;
}

function issueStatusBadge(issue: Issue): string {
  if (issue.status === "sample") return chip("SAMPLE DATA", "warn");
  if (issue.status === "draft") return chip("DRAFT — pending review", "warn");
  return chip("published", "ok");
}

function eventCard(ev: Event, opts: { week?: string; repoUrl?: string } = {}): string {
  const dates = dateLabels(ev)
    .map((d) => `<span class="date">${esc(d.label)} <time>${esc(d.value)}</time></span>`)
    .join(" · ");
  const sources = ev.sources
    .map(
      (s) =>
        `<a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a><span class="sr"> (${esc(s.kind)})</span>`,
    )
    .join('<span class="sep"> · </span>');
  const policy = ev.policy_id
    ? `<a class="policy-link" href="/policy-tracker/#${esc(ev.policy_id)}">${esc(ev.policy_id)}</a>`
    : "";
  return `<article class="item" id="evt-${esc(ev.slug)}" data-id="${esc(ev.id)}"${opts.week ? ` data-week="${esc(opts.week)}"` : ""}>
  <h3>${esc(ev.title)}</h3>
  <p class="meta">${esc(ev.organization)} · ${esc(ev.region)} · ${esc(ev.doc_type)} · ${esc(ev.status)} ${policy}</p>
  <p class="topics">${ev.topics.map((t) => chip(t)).join("")}${ev.verified ? "" : chip("unverified", "warn")}</p>
  <p class="dates">${dates}</p>
  <p class="sources">Sources: ${sources}</p>
  <p><strong>What changed:</strong> ${esc(ev.what_changed)}</p>
  <p><strong>Why it matters:</strong> ${esc(ev.why_it_matters)}</p>
  ${ev.note ? `<p class="note">${esc(ev.note)}</p>` : ""}
</article>`;
}

function layout(
  cfg: ReturnType<typeof loadSiteConfig>,
  opts: { title: string; description: string; active: string; content: string; extraHead?: string },
): string {
  const navItems: [string, string][] = [
    ["/", "Latest issue"],
    ["/archive/", "Archive"],
    ["/policy-tracker/", "Policy tracker"],
    ["/sources/", "Sources"],
  ];
  const nav = navItems
    .map(([href, label]) => {
      const active = opts.active === href ? ' aria-current="page"' : "";
      return `<a href="${href}"${active}>${label}</a>`;
    })
    .join("");
  return `<!doctype html>
<html lang="${esc(cfg.site.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)} · ${esc(cfg.site.name)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="stylesheet" href="${assetUrl("/assets/styles.css")}">
${opts.extraHead ?? ""}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <p class="kicker">${esc(cfg.site.name)}</p>
    <h1><a href="/">${esc(cfg.site.tagline)}</a></h1>
    <nav aria-label="Main">${nav}</nav>
  </div>
</header>
<main id="main" class="wrap">
${opts.content}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p>${esc(cfg.editorial.counts_disclaimer)}</p>
    <p><a href="${esc(cfg.site.repo_url)}" rel="noopener">Repository</a> · Weekly briefing: Fridays 08:30 Europe/Berlin (CET/CEST handled).</p>
  </div>
</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

interface SiteData {
  events: Map<string, Event>;
  issues: Issue[]; // sorted ascending by week
  policies: Policy[];
}

function findIssuesEvents(issue: Issue, events: Map<string, Event>): Event[] {
  return issue.items.map((id) => events.get(id)).filter((e): e is Event => e !== undefined);
}

function archiveArticle(ev: Event, week: string): string {
  return `<div class="archive-row" data-id="${esc(ev.id)}" data-week="${esc(week)}" data-region="${esc(ev.region)}" data-org="${esc(ev.organization.toLowerCase())}" data-type="${esc(ev.doc_type)}" data-topics="${esc(ev.topics.join(" "))}">
  <p class="meta"><a href="/issues/${esc(week)}/#${esc(ev.id)}">${esc(week)}</a> · ${esc(ev.organization)} · ${esc(ev.region)}</p>
  <h3>${esc(ev.title)}</h3>
  <p class="topics">${ev.topics.map((t) => chip(t)).join("")}</p>
  <dl>
    <div><dt>What changed</dt><dd>${esc(ev.what_changed)}</dd></div>
    <div><dt>Why it matters</dt><dd>${esc(ev.why_it_matters)}</dd></div>
  </dl>
  <p class="sources">${ev.sources.map((s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a>`).join('<span class="sep"> · </span>')}</p>
</div>`;
}

function milestoneLine(m: Policy["milestones"][number]): string {
  const cls = STATUS_CHIP[m.status] ?? "";
  const date = m.date ? `<time>${esc(m.date)}</time>` : `<span class="unknown">date unknown</span>`;
  const verified = m.verified ? "" : chip("unverified", "warn");
  const src = m.source ? ` · <a href="${esc(m.source)}" rel="noopener">source</a>` : "";
  return `<li class="milestone"><span class="chip st ${esc(cls)}">${esc(m.status)}</span> ${date} — ${esc(m.label)} ${verified}${src}</li>`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function pageLatest(cfg: ReturnType<typeof loadSiteConfig>, data: SiteData): string {
  const issue = data.issues.at(-1);
  const none = `<section><p>No issues yet. The weekly pipeline (Fridays 08:30 Europe/Berlin) will open a pull request with the first briefing.</p></section>`;
  if (!issue) return layout(cfg, { title: "Latest issue", description: cfg.site.description, active: "/", content: none });
  const evs = findIssuesEvents(issue, data.events);
  const cards = evs.map((ev, i) => eventCard(ev, { week: issue.id, repoUrl: cfg.site.repo_url })).join("\n");
  const downloads = [
    [`/files/${issue.id}/index.md`, "Markdown"],
    [`/files/${issue.id}/index.html`, "HTML (standalone)"],
    [`/files/${issue.id}/substack.md`, "Substack draft"],
  ]
    .map(([href, label]) => `<a class="button" href="${esc(href!)}" download>${esc(label!)}</a>`)
    .join(" ");
  const ghBase = cfg.site.repo_url ? `${cfg.site.repo_url}/blob/main` : null;
  const ghLinks = ghBase
    ? `<p class="meta">In-repo: <a href="${esc(ghBase)}/issues/${esc(issue.id)}/index.md" rel="noopener">index.md</a> · <a href="${esc(ghBase)}/issues/${esc(issue.id)}/index.html" rel="noopener">index.html</a> · <a href="${esc(ghBase)}/issues/${esc(issue.id)}/substack.md" rel="noopener">substack.md</a> · <a href="${esc(ghBase)}/data/issues/${esc(issue.id)}.json" rel="noopener">dataset</a></p>`
    : "";
  const sampleNote =
    issue.status === "sample"
      ? `<p class="banner warn">Sample issue: pre-seeded demo data from source briefs, not produced by the live pipeline. The first live issue replaces the sample on merge.</p>`
      : "";
  const content = `<section class="issue-head">
  ${issueStatusBadge(issue)}
  <h2>Latest issue: ${esc(issue.id)}</h2>
  <p class="period">${esc(dateRangeOf(issue.week_start))}</p>
  <p>${esc(issue.summary)}</p>
  ${issue.signal ? `<h3>Overall signal</h3><p>${esc(issue.signal)}</p>` : ""}
  ${sampleNote}
  <p class="downloads">${downloads}</p>
  ${ghLinks}
</section>
<section class="items">
  ${cards}
</section>
<p class="meta"><a href="/archive/">Browse the archive</a> · <a href="/policy-tracker/">Policy tracker</a>${data.issues.length > 1 ? ` · <a href="/issues/">All issues (${data.issues.length})</a>` : ""}</p>`;

  return layout(cfg, {
    title: `Latest issue ${issue.id}`,
    description: `${cfg.site.name} — week ${issue.id} briefing`,
    active: "/",
    content,
  });
}

function pageArchive(cfg: ReturnType<typeof loadSiteConfig>, data: SiteData, allRows: string): string {
  const rows = allRows;
  const topics = [...new Set([...data.events.values()].flatMap((e) => e.topics))].sort();
  const regions = [...new Set([...data.events.values()].map((e) => e.region))].sort();
  const docTypes = [...new Set([...data.events.values()].map((e) => e.doc_type))].sort();
  const weeks = data.issues.map((i) => i.id).reverse();
  const opt = (v: string): string => `<option value="${esc(v)}">${esc(v)}</option>`;
  const content = `<section>
  <h2>Archive</h2>
  <p class="meta">${data.issues.length} issue(s) · ${data.events.size} recorded event(s). Filters and search are stored in the page URL, so a filtered view can be shared directly.</p>
  <form id="filters" class="filters" role="search" aria-label="Filter the archive">
    <label>Search <input type="search" name="q" placeholder="e.g. diamond OA, consultation"></label>
    <label>Topic <select name="topic"><option value="">All topics</option>${topics.map(opt).join("")}</select></label>
    <label>Region <select name="region"><option value="">All regions</option>${regions.map(opt).join("")}</select></label>
    <label>Document type <select name="type"><option value="">All types</option>${docTypes.map(opt).join("")}</select></label>
    <label>Organization <input type="search" name="org" placeholder="e.g. UNESCO"></label>
    <label>Week <select name="week"><option value="">All weeks</option>${weeks.map(opt).join("")}</select></label>
    <button type="reset">Clear</button>
    <span id="count" class="meta" aria-live="polite"></span>
  </form>
</section>
<section id="results" aria-label="Search results">
  ${rows || "<p>No recorded events yet.</p>"}
</section>
<p class="meta" id="no-results" hidden>No items match the current filters.</p>`;
  // Prime the client-side index with every event's searchable text.
  const index = [...data.events.values()].map((ev) => ({
    id: ev.id,
    week: (data.issues.find((i) => i.items.includes(ev.id))?.id) ?? "",
    text: `${ev.title} ${ev.organization} ${ev.region} ${ev.topics.join(" ")} ${ev.doc_type} ${ev.what_changed} ${ev.why_it_matters}`.toLowerCase(),
  }));
  const head = `<link rel="preload" href="/search-index.json" as="fetch" crossorigin>`;
  void index;
  return layout(cfg, {
    title: "Archive",
    description: "Full-text search and filters across all recorded items.",
    active: "/archive/",
    content,
    extraHead: `${head}<script src="${assetUrl("/assets/archive.js")}" defer></script>`,
  });
}

function pageIssuesIndex(cfg, data: SiteData): string {
  const items = data.issues
    .slice()
    .reverse()
    .map((issue) => {
      const evs = findIssuesEvents(issue, data.events);
      return `<li>
  <a href="/issues/${esc(issue.id)}/"><strong>${esc(issue.id)}</strong></a> — ${esc(dateRangeOf(issue.week_start))} · ${evs.length} item(s) ${issue.status === "sample" ? chip("SAMPLE", "warn") : ""}
  <p class="meta">${esc(issue.summary)}</p>
</li>`;
    })
    .join("\n");
  return layout(cfg, {
    title: "All issues",
    description: "All weekly issues of the Open Science Monitor.",
    active: "/archive/",
    content: `<h2>All issues</h2><ol class="issues-list">${items}</ol>`,
  });
}

function pageIssue(cfg: ReturnType<typeof loadSiteConfig>, issue: Issue, data: SiteData): string {
  const evs = findIssuesEvents(issue, data.events);
  const cards = evs.map((ev) => eventCard(ev, { week: issue.id, repoUrl: cfg.site.repo_url })).join("\n");
  const sampleNote =
    issue.status === "sample"
      ? `<p class="banner warn">Sample issue: pre-seeded demo data, not produced by the live pipeline.</p>`
      : issue.status === "draft"
        ? `<p class="banner warn">Draft issue: pending editorial review.</p>`
        : "";
  const content = `<section class="issue-head">
  ${issueStatusBadge(issue)}
  <h2>Issue ${esc(issue.id)}</h2>
  <p class="period">${esc(dateRangeOf(issue.week_start))}</p>
  <p>${esc(issue.summary)}</p>
  ${issue.signal ? `<h3>Overall signal</h3><p>${esc(issue.signal)}</p>` : ""}
  ${sampleNote}
  <p class="downloads">
    <a class="button" href="/files/${esc(issue.id)}/index.md" download>Markdown</a>
    <a class="button" href="/files/${esc(issue.id)}/index.html" download>HTML (standalone)</a>
    <a class="button" href="/files/${esc(issue.id)}/substack.md" download>Substack draft</a>
  </p>
</section>
<section class="items">
  ${cards}
</section>`;
  return layout(cfg, {
    title: `Issue ${issue.id}`,
    description: `Open Science Monitor briefing for week ${issue.id}.`,
    active: "/archive/",
    content,
  });
}

function pagePolicyTracker(cfg: ReturnType<typeof loadSiteConfig>, data: SiteData): string {
  const cards = data.policies
    .map((pol) => {
      const related = [...data.events.values()]
        .filter((e) => e.policy_id === pol.id)
        .sort((a, b) => (b.dates.discovered ?? "").localeCompare(a.dates.discovered ?? ""));
      const rel = related
        .map((ev) => {
          const weeks = ev.appearances.map((w) => `<a href="/issues/${esc(w)}/#${esc(ev.id)}">${esc(w)}</a>`).join(", ");
          return `<li>${esc(ev.title)} <span class="meta">(covered in ${weeks || "—"})</span></li>`;
        })
        .join("");
      return `<section class="policy" id="${esc(pol.id)}">
  <h3>${esc(pol.name)}</h3>
  <p class="meta">${esc(pol.organization)} · ${esc(pol.region)} · ${esc(pol.type)} ${pol.verified ? "" : chip("unverified", "warn")}</p>
  <p>${esc(pol.description)}</p>
  <ul class="timeline">${[...pol.milestones].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999")).map(milestoneLine).join("")}</ul>
  ${rel ? `<h4>Related recorded events</h4><ul class="related">${rel}</ul>` : ""}
</section>`;
    })
    .join("\n");
  const content = `<h2>Policy tracker</h2>
<p class="meta">Items are grouped by policy or initiative. Milestone states are recorded from sources and can be incomplete; anything not yet human-verified carries an <em>unverified</em> label.</p>
${cards || "<p>No policies tracked yet.</p>"}`;
  return layout(cfg, {
    title: "Policy tracker",
    description: "Policies and initiatives grouped, with milestones and verification status.",
    active: "/policy-tracker/",
    content,
  });
}

function pageSources(cfg: ReturnType<typeof loadSiteConfig>, root: string): string {
  const src = loadSources(root);
  if (src.issues.length > 0) {
    throw new Error(`sources.yml invalid: ${src.issues[0]?.path}: ${src.issues[0]?.message}`);
  }
  const status = loadSourceStatus(root);
  const enabled = src.raw.sources.filter((s) => s.enabled);
  const disabled = src.raw.sources.filter((s) => !s.enabled);
  const suggestUrl = `${cfg.site.repo_url}/issues/new?template=source-suggestion.yml`;
  const rows = (list: typeof src.raw.sources) =>
    list
      .map((s) => {
        const st = status?.entries[s.id];
        const state = s.enabled
          ? `<span class="chip ok">on</span>`
          : `<span class="chip">off</span>`;
        const lastChecked = st ? `<time>${esc(st.last_checked)}</time> ${st.ok ? chip("OK", "ok") : chip("failing", "warn")}` : "not run yet";
        return `<tr>
  <td>${state}</td>
  <td><a href="${esc(s.url)}" rel="noopener">${esc(s.name)}</a><br><span class="meta">${esc(s.id)} · ${esc(s.priority)}</span></td>
  <td>${esc(s.kind)}</td>
  <td>${esc(s.region)}</td>
  <td>${esc(s.language)}</td>
  <td>${esc(s.method)}</td>
  <td>${lastChecked}</td>
  <td class="notes">${esc(s.notes)}</td>
</tr>`;
      })
      .join("\n");
  const gaps = src.raw.coverage.gaps.map((g) => `<li>${esc(g)}</li>`).join("");
  const content = `<h2>Sources</h2>
<p>${esc(src.raw.coverage.scope)}</p>
<p class="meta">Catalogue last reviewed ${esc(src.raw.coverage.as_of)} · ${enabled.length} enabled · ${disabled.length} disabled (known gaps) · every enabled source was fetched and parsed before being switched on.</p>
<h3>Coverage gaps</h3>
<ul class="gaps">${gaps}</ul>
<h3>How to add a source</h3>
<p>${esc(src.raw.coverage.how_to_add)}</p>
<p><a class="button" href="${esc(suggestUrl)}" rel="noopener">Suggest a source (GitHub issue form)</a></p>
<h3>Monitored sources</h3>
<table class="sources">
  <thead><tr><th>State</th><th>Source</th><th>Kind</th><th>Region</th><th>Lang.</th><th>Method</th><th>Last checked</th><th>Notes</th></tr></thead>
  <tbody>
  ${rows(enabled)}
  ${rows(disabled)}
  </tbody>
</table>`;
  return layout(cfg, {
    title: "Sources",
    description: "The monitored source catalogue, coverage and known gaps.",
    active: "/sources/",
    content,
  });
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildSite(root: string, outDir?: string): { files: string[] } {
  computeAssetVersion(root);
  const cfg = loadSiteConfig(root);
  const dist = outDir ?? path.join(root, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  const events = loadEvents(root);
  const issues = loadIssues(root);
  const policies = loadPolicies(root);
  const data: SiteData = { events, issues, policies };

  const write = (rel: string, content: string | Buffer): void => {
    const p = path.join(dist, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf8");
  };
  const copyFile = (from: string, rel: string): void => {
    if (!fs.existsSync(from)) return;
    const p = path.join(dist, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.copyFileSync(from, p);
  };

  const written: string[] = [];
  const track = (rel: string, content: string | Buffer): void => {
    write(rel, content);
    written.push(rel);
  };

  // Assets
  copyFile(path.join(root, "site", "assets", "styles.css"), "assets/styles.css");
  copyFile(path.join(root, "site", "assets", "archive.js"), "assets/archive.js");
  written.push("assets/styles.css", "assets/archive.js");

  // Pages
  track("index.html", pageLatest(cfg, data));

  const allRows = issues
    .slice()
    .reverse()
    .flatMap((issue) =>
      findIssuesEvents(issue, events).map((ev) => archiveArticle(ev, issue.id)),
    )
    .join("\n");
  track("archive/index.html", pageArchive(cfg, data, allRows));
  track("policy-tracker/index.html", pagePolicyTracker(cfg, data));
  track("sources/index.html", pageSources(cfg, root));
  track("issues/index.html", pageIssuesIndex(cfg, data));
  for (const issue of issues) {
    track(`issues/${issue.id}/index.html`, pageIssue(cfg, issue, data));
  }

  // Search index (client-side full-text)
  const searchIndex = issues
    .slice()
    .reverse()
    .flatMap((issue) =>
      findIssuesEvents(issue, events).map((ev) => ({
        id: ev.id,
        week: issue.id,
        title: ev.title,
        organization: ev.organization,
        region: ev.region,
        topics: ev.topics,
        docType: ev.doc_type,
        body: `${ev.what_changed}\n${ev.why_it_matters}`,
      })),
    );
  track("search-index.json", JSON.stringify(searchIndex));

  // Copies of the committed issue outputs (download links)
  for (const issue of issues) {
    for (const f of ["index.md", "index.html", "substack.md"] as const) {
      copyFile(path.join(root, "issues", issue.id, f), `files/${issue.id}/${f}`);
    }
  }

  return { files: written };
}

function main(): void {
  const root = rootFromArg(process.argv.slice(2)) || REPO_ROOT;
  const outIdx = process.argv.indexOf("--out");
  const outDir = outIdx !== -1 ? process.argv[outIdx + 1] : undefined;
  const { files } = buildSite(root, outDir);
  console.log(`Site built: ${files.length} generated page(s) + assets -> ${outDir ?? path.join(root, "dist")}`);
  for (const f of files) console.log(`  - ${f}`);
}

if (process.argv[1]?.endsWith("build-site.ts")) main();
