// Weekly issue pipeline CLI.
//
//   node scripts/run-issue.ts [--week 2026-W47] [--dry-run] [--root PATH]
//
// Steps (per the editorial process):
//   1. Load + validate the source catalogue.
//   2. Compute the ISO week and the collection window: the window runs from
//      the last published issue's cutoff to this week's Friday 08:30
//      Europe/Berlin. On a catch-up run (workflow_dispatch --week ...), the
//      horizon is the most recent existing issue before that week.
//   3. Collect all enabled feeds; per-source failures are recorded. If
//      collection fails on a broad scale, the run reports an error instead
//      of producing an issue that looks thorough.
//   4. Normalise URLs/dates/IDs; dedupe and merge duplicate coverage; score
//      editorial relevance. When an LLM secret is configured, ask it for
//      classification + draft paragraphs (suggestions only).
//   5. Write event records (stable IDs; re-runs update, never duplicate),
//      the issue dataset, and render index.md / index.html / substack.md
//      from the SAME validated dataset.
//   6. In GitHub Actions: open or update one pull request per week
//      (branch issue/<week>). Locally: print the summary and write the
//      PR body to data/run-reports/<week>-pr-body.md.

import * as fs from "node:fs";
import * as path from "node:path";

import type { Event, Issue, IssueRunReport, RawFeedItem } from "../shared/types.ts";
import { fridayBerlin830, isoWeekIdOf, mondayOfIsoWeek } from "../shared/iso-week.ts";
import { validate, type ValidationIssue } from "../shared/validate.ts";
import { loadEvents, loadIssues, loadSchema, loadSiteConfig, loadSources, REPO_ROOT, rootFromArg, sourcesById } from "./lib/data.ts";
import { collectAll } from "./pipeline/collect.ts";
import { eventsFromFeedItems, saveEvent } from "./pipeline/events.ts";
import { applySuggestions, draftSuggestions, llmConfigFromEnv } from "./pipeline/llm.ts";
import { nowIsoInstant, todayIso } from "./pipeline/normalize.ts";
import { renderIssueHtml, renderIssueMarkdown, renderIssueSubstack } from "./pipeline/render.ts";
import { gitPrepare, gitFinalize } from "./pipeline/git-ci.ts";

// When strictly fewer than this share of feeds succeed, fail loudly rather
// than publish a deceptively thin issue.
const MIN_FEED_SUCCESS_RATE = 0.5;
const ITEMS_MAX = 40;
const NOT_SHORTLISTED_MAX = 25;

function parseArgs(argv: string[]): { week?: string; dryRun: boolean; root: string } {
  const out = { week: undefined as string | undefined, dryRun: false, root: REPO_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--week") out.week = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--root") out.root = path.resolve(argv[++i]!);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

export function buildPrBody(
  issue: Issue,
  events: Event[],
  optionCount: number,
  gitHubBase?: string,
): string {
  const r = issue.run_report;
  const lines: string[] = [];
  lines.push(`## Issue ${issue.id} — weekly run report`);
  lines.push("");
  lines.push(`- **Items in this issue:** ${issue.counts.items} (candidates considered: ${optionCount})`);
  lines.push(`- **Window:** since ${r?.horizon_from ?? "n/a"} — cutoff ${r?.cutoff ?? "n/a"} (Friday 08:30 Europe/Berlin)`);
  lines.push(`- **Sources checked:** ${r?.sources_checked ?? 0} · **failed:** ${r?.sources_failed ?? 0} · **LLM assist:** ${r?.llm_assisted ? "used" : "not configured"}`);
  lines.push("");
  if (r && r.failures.length > 0) {
    lines.push(`**Failed sources:**`);
    for (const f of r.failures) lines.push(`- \`${f.id}\`: ${f.error}`);
    lines.push("");
  }
  lines.push(`**Editorial checklist**`);
  lines.push("");
  lines.push(`- [ ] Verify each item against its linked source`);
  lines.push(`- [ ] Replace auto-stub "What changed" / "Why it matters" text (unedited items say "Pending editorial review")`);
  lines.push(`- [ ] Set \`editorial_status: "edited"\`, write summary/signal, set details (dates, topics, policy links)`);
  lines.push(`- [ ] Merge this PR to publish the issue to the website`);
  lines.push("");
  lines.push(`**Outputs** (regenerated from the same dataset on every run):`);
  const base = gitHubBase ? `${gitHubBase}/blob/issue%2F${issue.id}` : null;
  const files: [string, string][] = [
    [`issues/${issue.id}/index.md`, "Markdown"],
    [`issues/${issue.id}/index.html`, "HTML (standalone)`"],
    [`issues/${issue.id}/substack.md`, "Substack draft"],
    [`data/issues/${issue.id}.json`, "Dataset"],
  ];
  for (const [file, label] of files) {
    lines.push(base ? `- ${label}: ${base}/${file}` : `- ${label}: \`${file}\``);
  }
  if (events.length > 0) {
    lines.push("");
    lines.push(`**Items:**`);
    for (const ev of events) {
      const src = ev.sources[0];
      lines.push(`- ${ev.title} — ${src ? `[${src.label}](${src.url})` : "(no source url)"}${ev.editorial_status === "pending" ? " · *pending editorial review*" : ""}`);
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { week: weekArg, dryRun, root } = parseArgs(process.argv.slice(2));
  const now = new Date();
  const week = weekArg ?? isoWeekIdOf(now);
  mondayOfIsoWeek(week); // validate the id exists
  const repository = process.env.GITHUB_REPOSITORY; // "owner/open-science-monitor"
  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const gitHubBase = repository ? `${serverUrl}/${repository}` : undefined;

  // 1. Sources ---------------------------------------------------------------
  const src = loadSources(root);
  if (src.issues.length > 0) {
    for (const i of src.issues) console.error(`sources.yml: ${i.path}: ${i.message}`);
    process.exit(1);
  }
  const byId = sourcesById(src.raw);
  const enabled = src.raw.sources.filter((s) => s.enabled && s.method !== "page");
  console.log(`Week ${week}: ${enabled.length} enabled feed sources.`);

  // 2. Window ----------------------------------------------------------------
  const cutoff = fridayBerlin830(week);
  const prevIssues = loadIssues(root).filter((i) => i.id < week);
  const prev = prevIssues.at(-1);
  const horizonInstant = prev ? prev.run_report?.cutoff ?? fridayBerlin830(prev.id).toISOString() : null;
  const horizonDay = horizonInstant ? horizonInstant.slice(0, 10) : null;
  console.log(`Window: ${horizonDay ?? "(no previous issue)"} -> ${cutoff.toISOString()}`);

  // 3. Collect ---------------------------------------------------------------
  const results = await collectAll(src.raw.sources);
  const okResults = results.filter((r) => r.ok);
  const feedsAttempted = results.length;
  const failures = results
    .filter((r) => !r.ok)
    .map((r) => ({ id: r.id, error: r.error ?? "unknown error" }));
  const successRate = feedsAttempted === 0 ? 0 : okResults.length / feedsAttempted;
  if (successRate < MIN_FEED_SUCCESS_RATE) {
    const report = {
      week,
      status: "failed-collection",
      at: nowIsoInstant(now),
      attempted: feedsAttempted,
      succeeded: okResults.length,
      success_rate: successRate,
      failures,
      note: "Broad fetch failure: reporting an error instead of creating an issue that would look thoroughly checked.",
    };
    writeJson(path.join(root, "data", "run-reports", `${week}-run.json`), report);
    console.error(`FATAL: only ${okResults.length}/${feedsAttempted} feeds succeeded (<${MIN_FEED_SUCCESS_RATE * 100}%). No issue created.`);
    for (const f of failures) console.error(`  - ${f.id}: ${f.error}`);
    process.exit(1);
  }

  // 4. Normalise, dedupe, score ------------------------------------------------
  const registry = loadEvents(root);
  const allItems: RawFeedItem[] = okResults.flatMap((r) => r.items);
  const candidates = eventsFromFeedItems(root, allItems, byId, registry, now);
  // Window filter: new discoveries pass through (the monitor just found
  // them); evaluated updates must touch the window.
  const inWindow = candidates.filter(({ candidate }) => {
    const ev = candidate.event;
    if (candidate.isNew) {
      const known = ev.dates.published ?? ev.dates.updated;
      if (!known) return true; // discovered-only; the item is labelled accordingly
      return horizonDay === null || known >= horizonDay;
    }
    if (!candidate.isUpdate) return false;
    return (
      horizonDay === null ||
      (ev.dates.updated ?? ev.dates.published ?? ev.dates.discovered) >= horizonDay
    );
  });
  // Items surfaced only now but published before the horizon are recorded as
  // checked-but-not-shortlisted (honest "older material resurfacing").
  const knownOld = candidates
    .filter(({ candidate }) => candidate.isNew)
    .filter(({ candidate }) => {
      const known = candidate.event.dates.published ?? candidate.event.dates.updated;
      return known !== null && horizonDay !== null && known < horizonDay;
    })
    .map((c) => ({
      title: c.candidate.event.title,
      reason: "older publication surfaced only now; before the collection window",
    }));
  // Relevance gate: editorial candidates need at least one topic match or a
  // core source. Everything else is recorded as checked-but-not-shortlisted.
  const shortlisted = inWindow.filter(
    ({ candidate, scored }) => scored.score > 0 || byId.get(candidate.primarySources[0]?.source_id ?? "")?.priority === "core",
  );
  const rejected = inWindow.filter((x) => !shortlisted.includes(x));
  const shortSorted = shortlisted
    .sort((a, b) => b.scored.score - a.scored.score || a.candidate.event.title.localeCompare(b.candidate.event.title))
    .slice(0, ITEMS_MAX);
  const droppedForCap = shortlisted.slice(ITEMS_MAX).length;
  console.log(
    `Candidates: ${inWindow.length} in window · shortlisted: ${shortlisted.length} · not shortlisted (low relevance): ${rejected.length}.`,
  );

  // 5. LLM assist (optional) ----------------------------------------------------
  const llmCfg = llmConfigFromEnv();
  let llmAssisted = false;
  let newEvents = shortSorted.filter((c) => c.candidate.isNew).map((c) => c.candidate.event);
  if (llmCfg && newEvents.length > 0) {
    const feedByEvent = new Map<string, RawFeedItem[]>(
      shortSorted.map((c) => [c.candidate.event.id, c.candidate.primarySources]),
    );
    console.log(`LLM assist: drafting ${newEvents.length} item(s) via ${llmCfg.model}.`);
    const suggestions = await draftSuggestions(newEvents, feedByEvent, llmCfg);
    newEvents = applySuggestions(newEvents, suggestions, llmCfg.model);
    llmAssisted = suggestions.size > 0;
  }

  // Persist events (stable ids: re-runs update, never duplicate).
  const eventMap = new Map(loadEvents(root));
  for (const c of shortSorted) {
    const ev = c.candidate.event;
    if (c.candidate.isNew) {
      const llmVersion = newEvents.find((e) => e.id === ev.id);
      eventMap.set(ev.id, llmVersion ?? ev);
    } else {
      const prevEv = eventMap.get(ev.id)!;
      eventMap.set(ev.id, { ...ev, what_changed: prevEv.what_changed, why_it_matters: prevEv.why_it_matters });
    }
  }
  // Apply LLM drafts to updated events too (classification only).

  // 6. Issue dataset (idempotent re-runs) ------------------------------------------
  const issuePath = path.join(root, "data", "issues", `${week}.json`);
  const existing = fs.existsSync(issuePath) ? (JSON.parse(fs.readFileSync(issuePath, "utf8")) as Issue) : null;
  const existingItems = existing ? existing.items.filter((id) => eventMap.has(id)) : [];
  const newIds = shortSorted.map((c) => c.candidate.event.id).filter((id) => !existingItems.includes(id));
  const itemIds = [...existingItems, ...newIds];
  for (const evId of itemIds) {
    const ev = eventMap.get(evId)!;
    if (!ev.appearances.includes(week)) ev.appearances.push(week);
    ev.appearances.sort();
  }
  const runReport: IssueRunReport = {
    cutoff: cutoff.toISOString(),
    horizon_from: horizonInstant,
    sources_checked: feedsAttempted,
    sources_failed: failures.length,
    failures,
    sources: results.map((r) => ({
      id: r.id,
      ok: r.ok,
      new_candidates: r.items.length,
      ...(r.error ? { error: r.error } : {}),
    })),
    notes: [],
    llm_assisted: llmAssisted,
  };
  if (rejected.length > 0) {
    const notShortlisted = rejected
      .slice(0, NOT_SHORTLISTED_MAX)
      .map((r) => ({ title: r.candidate.event.title, reason: "no topical match in the relevance filter (below threshold)" }));
    runReport.not_shortlisted = notShortlisted;
    if (rejected.length > NOT_SHORTLISTED_MAX) {
      runReport.not_shortlisted.push({
        title: `…and ${rejected.length - NOT_SHORTLISTED_MAX} more`,
        reason: "low relevance; see source counts above",
      });
    }
  }
  if (droppedForCap > 0) {
    runReport.notes.push(`Item cap of ${ITEMS_MAX} reached; ${droppedForCap} shortlisted candidate(s) deferred to the next run.`);
  }
  if (knownOld.length > 0) {
    runReport.not_shortlisted = [
      ...(runReport.not_shortlisted ?? []),
      ...knownOld.slice(0, NOT_SHORTLISTED_MAX),
    ];
  }
  const emptyWeekSummary =
    `Quiet week: no new, well-sourced items were found within the monitored sources${horizonDay ? ` since ${horizonDay}` : ""}. ${feedsAttempted - failures.length} of ${feedsAttempted} monitored feed sources were checked successfully.`;
  const issue: Issue = {
    id: week,
    week_start: mondayOfIsoWeek(week).toISOString().slice(0, 10),
    generated_at: nowIsoInstant(now),
    status: existing?.status ?? "draft",
    summary: existing?.summary ?? (itemIds.length > 0 ? `${itemIds.length} item(s) cleared the relevance gate. Editorial review pending.` : emptyWeekSummary),
    signal: existing?.signal ?? "",
    headline_event: existing?.headline_event ?? itemIds[0] ?? null,
    items: itemIds,
    counts: {
      items: itemIds.length,
      candidates: inWindow.length,
      sources_checked: feedsAttempted,
      sources_failed: failures.length,
    },
    run_report: runReport,
    paths: {
      markdown: `issues/${week}/index.md`,
      html: `issues/${week}/index.html`,
      substack: `issues/${week}/substack.md`,
    },
    ...(existing?.sample !== undefined ? { sample: existing.sample } : {}),
  };

  // Validate before writing anything.
  const schemas = {
    issue: loadSchema(root, "issue.schema.json"),
    event: loadSchema(root, "event.schema.json"),
  };
  const problems: ValidationIssue[] = [
    ...validate(issue, schemas.issue, `issue ${week}`),
  ];
  for (const id of itemIds) {
    problems.push(...validate(eventMap.get(id)!, schemas.event, `event ${id}`));
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`VALIDATION FAILED ${p.path}: ${p.message}`);
    writeJson(path.join(root, "data", "run-reports", `${week}-run.json`), { week, status: "invalid-data", problems, at: nowIsoInstant(now) });
    process.exit(1);
  }

  // 7. Render + write ------------------------------------------------------------
  const siteCfg = loadSiteConfig(root);
  const sortedEvents = itemIds.map((id) => eventMap.get(id)!);
  const issueDir = path.join(root, "issues", week);

  if (dryRun) {
    console.log("Dry run: no files written.");
    console.log(reportToConsole(issue, sortedEvents));
    process.exit(0);
  }

  // In Actions, switch to the per-week branch BEFORE writing files.
  const inCi = process.env.GITHUB_ACTIONS === "true" && !!repository;
  if (inCi) {
    gitPrepare({ root, week });
  }

  for (const c of shortSorted) saveEvent(root, eventMap.get(c.candidate.event.id)!);
  writeJson(issuePath, issue);
  writeText(path.join(issueDir, "index.md"), renderIssueMarkdown(issue, sortedEvents, { siteName: siteCfg.site.name, repoUrl: siteCfg.site.repo_url }));
  writeText(path.join(issueDir, "index.html"), renderIssueHtml(issue, sortedEvents, { siteName: siteCfg.site.name, repoUrl: siteCfg.site.repo_url }));
  writeText(path.join(issueDir, "substack.md"), renderIssueSubstack(issue, sortedEvents));

  // Source status: record what this run actually checked.
  const statusFile = path.join(root, "data", "source-status.json");
  const status = fs.existsSync(statusFile)
    ? (JSON.parse(fs.readFileSync(statusFile, "utf8")) as { as_of: string; entries: Record<string, unknown> })
    : { as_of: todayIso(now), entries: {} };
  status.as_of = todayIso(now);
  status.entries = status.entries ?? {};
  for (const r of results) {
    (status.entries as Record<string, unknown>)[r.id] = {
      ok: r.ok,
      items: r.items.length,
      last_checked: todayIso(now),
      ...(r.error ? { error: r.error } : {}),
    };
  }
  writeJson(statusFile, status);

  const prBody = buildPrBody(issue, sortedEvents, inWindow.length, gitHubBase);
  writeText(path.join(root, "data", "run-reports", `${week}-pr-body.md`), prBody);
  writeJson(path.join(root, "data", "run-reports", `${week}-run.json`), { week, status: "ok", at: nowIsoInstant(now), counts: issue.counts, failures });

  if (inCi) {
    gitFinalize({ root, week });
  }

  console.log(reportToConsole(issue, sortedEvents));
  console.log(`\nWritten: data/issues/${week}.json, issues/${week}/{index.md,index.html,substack.md}, data/run-reports/${week}-*`);
}

function reportToConsole(issue: Issue, events: Event[]): string {
  const lines = [
    `Issue ${issue.id}: ${issue.counts.items} item(s) · status ${issue.status}`,
    ...events.map((e) => `  - [${e.topics.join(",")}] ${e.title} (${e.organization})`),
  ];
  return lines.join("\n");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
