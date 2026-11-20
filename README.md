# Open Science Monitor

A monitoring hub for **Open Access (OA)** and **Open Science (OS)** policy developments, aimed at researchers, librarians, scholarly communication practitioners, funders and policy analysts. It produces a weekly briefing from a verified source catalogue and publishes a small, fast static website with an archive and a policy tracker.

- **Interface and newsletter language:** English
- **Scope:** international, deliberately including non-Anglophone and Global South sources
- **Website:** https://qtan-tran.github.io/open-science-monitor/ — the repository is public and the site is deployed by GitHub Actions.

---

## What is in here

| Path | What it is |
| --- | --- |
| `config/sources.yml` | The source catalogue: name, URL, kind, region, language, collection method, on/off. Coverage gaps are documented in `coverage.gaps`. |
| `config/site.yml` | Site metadata and the editorial counts disclaimer. |
| `schemas/*.schema.json` | JSON Schema (draft-07 subset) for sources, events, policies and issues. |
| `shared/` | Taxonomies and types, ISO-week/Berlin-time helpers, the schema validator, filter serialization. |
| `scripts/pipeline/` | Collect, normalize, dedupe, score, (optional) LLM assist, render, git/PR integration. |
| `scripts/run-issue.ts` | The weekly pipeline CLI. |
| `scripts/build-site.ts` | Static site generator (no dependencies). |
| `data/events/`, `data/policies/`, `data/issues/` | Durable records with stable IDs: developments, policies/initiatives, weekly issues. |
| `issues/<week>/` | Rendered weekly outputs: `index.md`, `index.html`, `substack.md` (editorial draft for your Substack newsletter). |
| `data/run-reports/` | Per-run reports and the PR body text. |
| `site/`, `dist/` | Site assets and the built website. |
| `tests/` | Unit + end-to-end test suite (plain `node --test`, no test framework). |

**Sample data:** `issues/2026-W42` … `2026-W45`, their datasets in `data/issues/` and the events in `data/events/` are **clearly marked samples** (`"sample": true`, status `"sample"`) modelled on the ROARA OA/OS policy briefs. They exist so you can try the whole editing and publishing flow before the first live week (2026-W47). Do not treat them as a live record of what happened in those weeks.

## Zero dependencies, on purpose

The whole project runs on plain **Node.js 22** (`npm install` is never needed and never run; CI does not execute npm). Astro and framework stacks normally require an install step that is not available in the authoring environment of this MVP, so the site generator, YAML/XML parsers, validator and workflow scripts are hand-written and small. The separation between collection, normalization, editing and rendering is kept strict (separate modules, JSON Schema at the boundaries), so migrating the presentation layer to Astro+TypeScript later is a contained change: point it at the validated JSON in `data/`.

Requirements:

- Node.js ≥ 22.18 (`.nvmrc`: 22)
- `git` and GitHub CLI (`gh`) only inside GitHub Actions for PR automation

## Website pages

- **Latest Issue** — the newest week, highlighted developments, download links for Markdown, HTML and the Substack draft.
- **Archive** — week-by-week list, full-text search, filters by topic / region / organization / type / week. Filter state lives in the URL, so any view can be shared as a link.
- **Policy Tracker** — items grouped by policy or initiative, with known milestones (draft, consultation, adopted, in force, revised). Anything not verified is labelled as such.
- **Sources** — the catalogue, its coverage gaps, the last-checked status and a link to the Source suggestion issue form.

Counts on the site describe **items recorded within the monitored sources**. They are not a measure of OA/OS activity of any country, and the site never presents them as one.

## Running locally

```bash
git clone https://github.com/qtan-tran/open-science-monitor.git
cd open-science-monitor

# 1. validate the data tree
node scripts/pipeline/validate-data.ts

# 2. run the tests (48 of them, including the end-to-end pipeline suite)
node --test "tests/*.test.ts"

# 3. build the website into dist/
node scripts/build-site.ts

# 4. serve it locally (loopback only) at http://127.0.0.1:4173
node scripts/serve-dist.ts
```

### Weekly issue pipeline

```bash
# current ISO week (collects from enabled feeds, writes dataset + renders; local mode does not touch git)
node scripts/run-issue.ts

# a specific week (catch-up: the horizon is the most recent published issue before that week)
node scripts/run-issue.ts --week 2026-W47

# preview without writing files
node scripts/run-issue.ts --dry-run
```

Every run:

1. Collects new or materially updated items from enabled feeds (RSS 2.0, Atom, RDF; 20 s timeout per source).
2. Canonicalizes URLs, derives stable event IDs (`evt-…`), distinguishes published / updated / effective / consultation-deadline / discovered dates. Items with only a discovery date are labelled as discovered-only.
3. Merges duplicate coverage (canonical URL identity, normalized titles, fuzzy title similarity) keeping the primary source plus additional valuable sources.
4. Applies a relevance gate; relevant items become **candidates with pending editorial status** and auto-stub paragraphs that must be replaced by an editor.
5. Validates everything against the schemas, then writes `data/issues/<week>.json`, `issues/<week>/{index.md,index.html,substack.md}`, `data/events/…`, `data/source-status.json` and `data/run-reports/<week>-*` from that one dataset.
6. Idempotent by construction: stable IDs mean a re-run of the same week updates files, it never duplicates events or PRs.

Guard rails:

- Per-source failures are recorded in the run report (and the PR body), never hidden.
- If **fewer than half** of the feeds succeed, the run exits `1` with a `failed-collection` report instead of creating a deceptively thin issue.
- A week with nothing worth publishing is honestly rendered as a quiet week, with the number of sources actually checked.
- Optional LLM assist (`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` secrets) only suggests classification and draft paragraphs. Without the secret the pipeline works unchanged; items just stay pending. Datasets always keep enough source material to verify every claim.

### GitHub Action schedule

`.github/workflows/weekly-issue.yml` runs two cron slots (`30 6` and `30 7` UTC on Fridays); `scripts/berlin-guard.ts` picks the one that is actually 08:30 Europe/Berlin under the current CET/CEST rule, so it never double-fires or shifts an hour. `workflow_dispatch` with a `week` input bypasses the guard for manual or catch-up runs.

## Reviewing the weekly PR

1. Every Friday (or after a manual dispatch) the action pushes the branch `issue/<week>` and opens/updates **one PR** per week.
2. Read the PR body: item count, window, sources checked vs failed, the editorial checklist.
3. Open `issues/<week>/index.md` (or the diff of `data/issues/<week>.json`) and verify each item against its source link. Replace the auto-stub "What changed" / "Why it matters" paragraphs, set `editorial_status: "edited"`, add topics/dates/policy links where applicable. Editorial rules: [docs/EDITING.md](docs/EDITING.md).
4. Re-render after edits: `node scripts/render-issue-outputs.ts`
5. Merge the PR.

## Getting the Substack draft

For any published week, `issues/<week>/substack.md` is the editable draft: suggested headline options, a lede and the highlighted items with their source links. Download it from the Latest Issue page (Markdown / HTML / Substack links), edit by hand, and send. It is editorial material, not a finished newsletter: verify every claim against the linked sources first.

## Adding a source

1. Open a **Source suggestion** issue (the Sources page links the form) with the organisation, feed or page URL, region and language.
2. The maintainer verifies the feed (fetch it, confirm it parses):
   ```bash
   node scripts/check-sources.ts            # fetches all enabled feeds and reports status
   ```
3. Add an entry to `config/sources.yml` (copy the shape of an existing entry), set `enabled: true`, add a `notes:` line and record the check if it changes coverage. Disabled entries document known gaps in `coverage.gaps`.
4. `node scripts/pipeline/validate-data.ts` validates the catalogue against `schemas/source.schema.json`.

## Publishing the website

Publication is approved and the site is live at https://qtan-tran.github.io/open-science-monitor/. Every push to `main` triggers `deploy-pages.yml`: validate → verify renders → build → deploy.

Prerequisite (done once in repo settings): **Settings → Pages → Build and deployment → Source: "GitHub Actions"**. The legacy "Deploy from a branch" mode serves a Jekyll default site instead of this build. An optional per-deploy approval gate is available at **Settings → Environments → `github-pages` → Required reviewers**.

If the live site ever serves a mix of new and missing pages (this can happen when several deploys are cancelled mid-run in quick succession, e.g. a burst of pushes), force a clean redeploy: **Actions → deploy-pages → Run workflow**, or push any commit to `main`, then give the CDN a few minutes to propagate.

## What was tested locally vs what needs GitHub

Ran and green locally (Node 22.20, 48/48 `node --test`):

- feed parsing (RSS 2.0/Atom/RDF, malformed XML, missing publication dates)
- URL canonicalization, stable IDs, duplicate merging (exact URL, normalized title, fuzzy title match)
- ISO week + CET/CEST math (both cron slots, DST edges, fake week IDs)
- JSON Schema validator + the full committed data tree
- end-to-end pipeline on a local fixture server: normal week, cross-feed merge, discovered-only item, failed sources in the report, same-week re-run determinism, honest quiet week, backfill horizon from the last published cutoff, widespread failure exit code, all output formats, URL filter round-trip, site build

Verifiable only on GitHub after the first push: the cron schedule firing on Friday 08:30 Europe/Berlin (first live slot: **2026-W47, Friday 2026-11-20**), branch/PR creation via `git`/`gh`, and the Pages deploy. Run `weekly-issue` via `workflow_dispatch` once to confirm.

## Extensibility (reserved, not built yet)

The data model keeps sources, events, policies and issues separate with stable IDs, and renders derive from the same validated datasets. That leaves clean paths for: a **Consultation Calendar** (deadline dates already exist per event; `.ics` export), **Watchlists** (per-filter RSS), **Research & Evidence** (DOI-bearing study events; CSV/BibTeX export) and **Policy Comparisons** (per-policy provisions). The MVP deliberately implements only the four pages above.

## License

All rights reserved. The repository is public; add an OSS license (for example MIT) in a dedicated commit if you want to permit reuse of the code.
