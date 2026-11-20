// Renderers: turn a validated issue dataset (issue JSON + event records)
// into the three committed output formats. All formats come from the SAME
// dataset; renderers are pure functions with no filesystem access.

import type { Event, Issue } from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface DateLabel {
  label: string;
  value: string;
}

/** Distinguish publication/update/effect/deadline/discovery dates. */
export function dateLabels(ev: Event): DateLabel[] {
  const out: DateLabel[] = [];
  if (ev.dates.published) out.push({ label: "Published", value: ev.dates.published });
  if (ev.dates.updated) out.push({ label: "Updated", value: ev.dates.updated });
  if (ev.dates.effective) out.push({ label: "In force from", value: ev.dates.effective });
  if (ev.dates.consultation_deadline) out.push({ label: "Consultation deadline", value: ev.dates.consultation_deadline });
  out.push({ label: "Recorded", value: ev.dates.discovered });
  if (!ev.dates.published && !ev.dates.updated) {
    // Only a discovery date is known: label it explicitly.
    return [
      { label: "Publication date unknown; discovered by the monitor on", value: ev.dates.discovered },
    ];
  }
  return out;
}

export function dateRangeOf(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start.getTime() + 4 * 24 * 3600 * 1000);
  const fmt = (d: Date): string =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function statusLine(ev: Event): string {
  const parts = [ev.status, `${ev.region}`, `topics: ${ev.topics.join(", ")}`, ev.doc_type];
  if (!ev.verified) parts.push("unverified");
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Markdown (issues/<week>/index.md)
// ---------------------------------------------------------------------------

export function renderIssueMarkdown(
  issue: Issue,
  events: Event[],
  opts: { siteName: string; repoUrl?: string } = { siteName: "Open Science Monitor" },
): string {
  const lines: string[] = [];
  const banner =
    issue.status === "sample"
      ? "SAMPLE ISSUE — pre-seeded demo data, not from the live pipeline."
      : issue.status === "draft"
        ? "Draft issue — pending editorial review. Merge the issue PR to publish."
        : "Published.";
  lines.push(`# ${opts.siteName} — ${issue.id} (${dateRangeOf(issue.week_start)})`);
  lines.push("");
  lines.push(`> ${banner} Generated ${issue.generated_at}. ${issue.counts.items} item(s) recorded within the monitored source list. Source failures and coverage notes: see run report in \`data/issues/${issue.id}.json\`.`);
  lines.push("");
  lines.push(issue.summary);
  lines.push("");
  if (issue.signal) {
    lines.push(`## Overall signal`);
    lines.push("");
    lines.push(issue.signal);
    lines.push("");
  }
  events.forEach((ev, i) => {
    lines.push(`## ${i + 1}. ${ev.title}`);
    lines.push("");
    lines.push(`**${ev.organization}** — ${statusLine(ev)}`);
    lines.push("");
    lines.push(dateLabels(ev).map((d) => `${d.label}: ${d.value}`).join(" · "));
    lines.push("");
    const src = ev.sources.map((s) => `[${s.label}](${s.url}) (${s.kind})`).join(" · ");
    lines.push(`Sources: ${src}`);
    lines.push("");
    lines.push(`**What changed:** ${ev.what_changed}`);
    lines.push("");
    lines.push(`**Why it matters:** ${ev.why_it_matters}`);
    if (ev.policy_id) lines.push(`\nPolicy thread: \`${ev.policy_id}\``);
    lines.push(`\nEvent ID: \`${ev.id}\`${ev.supersedes ? ` · supersedes \`${ev.supersedes}\`` : ""}`);
    lines.push("");
  });
  if (issue.run_report) {
    const r = issue.run_report;
    lines.push(`## Run report (${issue.id})`);
    lines.push("");
    lines.push(`Window: since ${r.horizon_from ?? "n/a"} — cutoff ${r.cutoff} (Friday 08:30 Europe/Berlin). Sources checked: ${r.sources_checked}; failed: ${r.sources_failed}. LLM assist: ${r.llm_assisted ? "used" : "not configured"}.`);
    if (r.failures.length > 0) {
      lines.push("");
      lines.push(`Failed sources:`);
      for (const f of r.failures) lines.push(`- \`${f.id}\`: ${f.error}`);
    }
    for (const n of r.notes) {
      lines.push("");
      lines.push(n);
    }
    if (r.not_shortlisted && r.not_shortlisted.length > 0) {
      lines.push("");
      lines.push(`Checked but not shortlisted:`);
      for (const x of r.not_shortlisted) lines.push(`- ${x.title} — ${x.reason}`);
    }
    lines.push("");
  }
  lines.push(`---`);
  lines.push("");
  lines.push(`*This briefing records developments within the monitored source list. Counts are not a proxy for a country's or region's overall Open Access / Open Science activity.*`);
  lines.push("");
  if (opts.repoUrl) lines.push(`Monitor home: <${opts.repoUrl}>`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Substack draft (issues/<week>/substack.md) — manual editing input
// ---------------------------------------------------------------------------

export function renderIssueSubstack(issue: Issue, events: Event[]): string {
  const lines: string[] = [];
  const top = events[0];
  lines.push("# Suggested headline");
  lines.push("");
  const suggestions = top ? [top.title, `${top.organization}: ${shorten(top.title, 90)}`] : [];
  suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("");
  lines.push("# Lede (draft)");
  lines.push("");
  lines.push(issue.summary);
  lines.push("");
  if (issue.signal) {
    lines.push(issue.signal);
    lines.push("");
  }
  lines.push("# Highlights (draft order)");
  lines.push("");
  events.forEach((ev, i) => {
    lines.push(`**${i + 1}. ${ev.title}** — ${ev.organization}`);
    lines.push("");
    lines.push(oneLine(ev));
    lines.push("");
    for (const s of ev.sources) lines.push(`- [${s.label}](${s.url})`);
    const dl = ev.dates.consultation_deadline;
    if (dl) lines.push(`- Consultation deadline: **${dl}**`);
    lines.push("");
  });
  lines.push("---");
  lines.push("");
  lines.push("*Editorial notes: this file is a draft for manual Substack editing. Verify every claim against the linked sources before publishing. Do not paste unverified LLM output directly.*");
  return lines.join("\n");
}

function oneLine(ev: Event): string {
  const src = `${ev.what_changed} `;
  const clean = src.replace(/Pending editorial review\.?/g, "").trim();
  const text = clean.length > 40 ? clean : ev.title;
  const sentence = text.split(/(?<=\.)\s/)[0] ?? text;
  return shorten(sentence, 220);
}

function shorten(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Standalone HTML (issues/<week>/index.html)
// ---------------------------------------------------------------------------

const STANDALONE_CSS = `
:root {
  color-scheme: light dark;
  --paper: #f5f6f8; --card: #fff; --ink: #0f172a; --muted: #64748b; --line: #e2e8f0;
  --accent: #0d7a6f; --accent-strong: #0a5f57; --accent-soft: #e6f4f2;
  --link: #0b6bb8; --warn-bg: #fef3c7; --warn-bd: #d97706; --warn-ink: #92400e;
  --shadow: 0 6px 20px -6px rgba(15,23,42,.14);
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "SF Mono", Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #0b1220; --card: #111a2b; --ink: #e5eaf2; --muted: #8b98ac; --line: #22304a;
    --accent: #2bbfae; --accent-strong: #56d6c8; --accent-soft: #0f2a2a;
    --link: #6cb6ff; --warn-bg: #2c2210; --warn-bd: #b45309; --warn-ink: #fbbf24;
    --shadow: 0 8px 24px -8px rgba(0,0,0,.6);
  }
}
* { box-sizing: border-box; }
body { margin: 0; font: 1rem/1.7 var(--sans); color: var(--ink); background: var(--paper); }
main { max-width: 48rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
header.site {
  background: linear-gradient(135deg, var(--accent-soft), transparent 70%);
  border: 1px solid var(--line); border-radius: 12px;
  box-shadow: var(--shadow); padding: 1.4rem 1.5rem; margin-bottom: 1.5rem;
}
header.site p { font-size: .85rem; color: var(--muted); margin: .3rem 0 1rem; }
header.site p:first-child {
  font-weight: 700; font-size: .72rem; letter-spacing: .14em;
  text-transform: uppercase; color: var(--accent); margin-bottom: .4rem;
}
h1 { font-size: 1.6rem; line-height: 1.25; letter-spacing: -.015em; margin: 0 0 .4rem; }
h2 { font-size: 1.15rem; letter-spacing: -.01em; margin: 1.6rem 0 .5rem; }
article {
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: var(--shadow); padding: 1.2rem 1.35rem; margin: 1rem 0;
}
article > h2 { margin: .1rem 0 .4rem; }
.status { font-size: .78rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin: 0 0 .5rem; }
.badge {
  display: inline-flex; font-size: .72rem; padding: .28rem .6rem;
  border: 1px solid var(--line); border-radius: 999px; margin: .15rem .25rem .35rem 0;
  background: var(--paper); color: var(--muted);
}
.badge.warn { border-color: var(--warn-bd); color: var(--warn-ink); background: var(--warn-bg); }
.dates { color: var(--muted); font-size: .92rem; }
.sources { font-size: .88rem; }
code { font: .85em var(--mono); background: var(--accent-soft); padding: .1em .35em; border-radius: 4px; }
a { color: var(--link); text-underline-offset: 3px; }
footer { margin-top: 3rem; border-top: 1px solid var(--line); padding-top: 1.2rem; font-size: .85rem; color: var(--muted); }
blockquote { border-inline-start: 3px solid var(--line); margin: 1rem 0; padding: .25rem 0 .25rem 1rem; color: var(--muted); }
table { border-collapse: collapse; width: 100%; font-size: .88rem; }
th, td { border: 1px solid var(--line); padding: .4rem .5rem; text-align: left; background: var(--card); }
@media (prefers-color-scheme: dark) { th, td { background: var(--paper); } }
`;

export function renderIssueHtml(
  issue: Issue,
  events: Event[],
  opts: { siteName: string; repoUrl?: string } = { siteName: "Open Science Monitor" },
): string {
  const banner =
    issue.status === "sample"
      ? `SAMPLE ISSUE — pre-seeded demo data, not from the live pipeline.`
      : issue.status === "draft"
        ? `Draft — pending editorial review.`
        : `Published.`;
  const items = events
    .map((ev, i) => {
      const dates = dateLabels(ev)
        .map((d) => `<span class="dates">${esc(d.label)}: ${esc(d.value)}</span>`)
        .join(" · ");
      const src = ev.sources
        .map((s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a> <small>(${esc(s.kind)})</small>`)
        .join(" · ");
      const badges = ev.topics
        .map((t) => `<span class="badge">${esc(t)}</span>`)
        .join("");
      const warn = ev.verified ? "" : `<span class="badge warn">unverified</span>`;
      return `<article id="${esc(ev.id)}">
  <h2>${i + 1}. ${esc(ev.title)}</h2>
  <p class="status">${esc(ev.status)} · ${esc(ev.organization)} · ${esc(ev.region)} · ${esc(ev.doc_type)}${ev.policy_id ? ` · policy <code>${esc(ev.policy_id)}</code>` : ""}</p>
  ${badges}${warn}
  <p>${dates}</p>
  <p class="sources">Sources: ${src}</p>
  <p><strong>What changed:</strong> ${esc(ev.what_changed)}</p>
  <p><strong>Why it matters:</strong> ${esc(ev.why_it_matters)}</p>
  ${ev.supersedes ? `<p class="dates">Supersedes event <code>${esc(ev.supersedes)}</code>.</p>` : ""}
</article>`;
    })
    .join("\n");

  const report = issue.run_report;
  const reportHtml = report
    ? `<h2>Run report</h2>
<p>Window since ${esc(report.horizon_from ?? "n/a")} · cutoff ${esc(report.cutoff)} (Friday 08:30 Europe/Berlin). Sources checked: ${report.sources_checked}; failed: ${report.sources_failed}. LLM assist: ${report.llm_assisted ? "used" : "not configured"}.</p>
${report.failures.length > 0 ? `<table><thead><tr><th>Failed source</th><th>Error</th></tr></thead><tbody>${report.failures
        .map((f) => `<tr><td>${esc(f.id)}</td><td>${esc(f.error)}</td></tr>`)
        .join("")}</tbody></table>` : ""}
${(report.not_shortlisted ?? []).map((x) => `<p class="dates">Checked but not shortlisted: ${esc(x.title)} — ${esc(x.reason)}</p>`).join("")}`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.siteName)} — ${esc(issue.id)}</title>
<style>${STANDALONE_CSS}</style>
</head>
<body>
<main>
<header class="site">
  <p>${esc(opts.siteName)}</p>
  <h1>${esc(issue.id)} · ${esc(dateRangeOf(issue.week_start))}</h1>
  <p class="status">${esc(banner)} Generated ${esc(issue.generated_at)} · ${issue.counts.items} item(s) recorded</p>
</header>
<p>${esc(issue.summary)}</p>
${issue.signal ? `<h2>Overall signal</h2>\n<p>${esc(issue.signal)}</p>` : ""}
${items}
${reportHtml}
<footer>
  <p>Every item is recorded within the monitored source list; counts are not a proxy for a country's or region's Open Access / Open Science activity.</p>
  ${opts.repoUrl ? `<p><a href="${esc(opts.repoUrl)}" rel="noopener">Monitor repository</a></p>` : ""}
</footer>
</main>
</body>
</html>
`;
}
