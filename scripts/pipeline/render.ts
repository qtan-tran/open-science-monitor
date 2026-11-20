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
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { font: 1rem/1.65 Georgia, "Times New Roman", serif; color: #1c1917; background: #faf9f6; margin: 0; }
main { max-width: 46rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
header.site { border-bottom: 3px double #1c1917; margin-bottom: 1.5rem; }
header.site p { font-family: system-ui, sans-serif; font-size: .85rem; color: #57534e; margin: .3rem 0 1rem; }
h1 { font-size: 1.6rem; line-height: 1.25; margin: 1rem 0 .5rem; }
h2 { font-size: 1.15rem; margin: 2.2rem 0 .6rem; border-top: 1px solid #d6d3d1; padding-top: 1.4rem; }
.status { font-family: system-ui, sans-serif; font-size: .78rem; color: #57534e; text-transform: uppercase; letter-spacing: .04em; }
.badge { display: inline-block; font-family: system-ui, sans-serif; font-size: .72rem; padding: .1rem .5rem; border: 1px solid #d6d3d1; border-radius: 1rem; margin: 0 .25rem .25rem 0; background: #fff; }
.badge.warn { border-color: #b45309; color: #92400e; background: #fffbeb; }
.dates { font-style: italic; color: #57534e; font-size: .92rem; }
.sources { font-size: .88rem; }
a { color: #1d4ed8; }
footer { margin-top: 3rem; border-top: 1px solid #d6d3d1; padding-top: 1rem; font-size: .85rem; color: #57534e; }
blockquote { border-inline-start: 3px solid #d6d3d1; margin: 1rem 0; padding: .25rem 0 .25rem 1rem; color: #44403c; }
table { border-collapse: collapse; width: 100%; font-size: .88rem; }
th, td { border: 1px solid #d6d3d1; padding: .4rem .5rem; text-align: left; }
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
