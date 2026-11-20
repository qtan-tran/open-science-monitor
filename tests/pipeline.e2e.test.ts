// End-to-end pipeline tests against a local fixture HTTP server on 127.0.0.1.
// Covers: normal weekly run, duplicate merging across feeds, items without a
// publication date, same-week re-run determinism, horizon/backfill windows,
// honest quiet weeks, broad fetch failure (exit 1), output formats, schema
// validation, and the static site build from a synthetic root.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { createServer } from "node:http";

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEEK = "2026-W47";
const NEXT_WEEK = "2026-W48";
const FAR_WEEK = "2026-W49";

const RSS_DEFAULT = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Core Funder News</title>
<item><title>cOAlition S publishes updated open access policy guidance</title><link>https://example.org/plan-s-update</link><pubDate>Wed, 18 Nov 2026 10:00:00 GMT</pubDate><description>New open access policy guidance for grantees.</description></item>
<item><title>Funder coalition extends rights retention policy to books</title><link>https://example.org/rr-books?utm_source=rss</link><pubDate>Tue, 17 Nov 2026 09:00:00 GMT</pubDate><description>Rights retention now covers books as well.</description></item>
</channel></rss>`;

const ATOM_DEFAULT = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Source</title>
<entry><title>Funder coalition extends rights retention policy to books</title><link rel="alternate" href="https://example.org/rr-books"/><id>urn:x:1</id><published>2026-11-17T08:00:00Z</published><updated>2026-11-19T08:00:00Z</updated><summary>Rights retention extended to books.</summary></entry>
</feed>`;

const RSS_NODATE = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Watcher</title>
<item><title>Ministry opens consultation on research data policy</title><link>https://example.org/consultation-rd</link><description>A public consultation on research data management is open for input.</description></item>
</channel></rss>`;

const RSS_IRRELEVANT_LATE = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Off Topic</title>
<item><title>Regional garden show announces 2027 tulip programme</title><link>https://example.org/tulips-late</link><pubDate>Tue, 24 Nov 2026 10:00:00 GMT</pubDate><description>Tulips and garden design.</description></item>
</channel></rss>`;

const RSS_OLD_RELEVANT = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Core Funder News</title>
<item><title>cOAlition S publishes updated open access policy guidance for archived items</title><link>https://example.org/plan-s-update-archive</link><pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate><description>An older open access policy story resurfacing now.</description></item>
</channel></rss>`;

interface Route {
  status: number;
  body: string;
  type: string;
}

let server: Server | null = null;
let port = 0;
let root = "";
const routes = new Map<string, Route>();

function setRoute(p: string, r: Route): void {
  routes.set(p, r);
}

function xml(body: string): Route {
  return { status: 200, body, type: "application/xml; charset=utf-8" };
}

// Async spawn (NOT spawnSync): the fixture HTTP server lives in THIS process,
// and spawnSync would block the event loop -> deadlock the child's fetches.
function run(script: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, script), ...args], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.stdout!.on("data", (d) => (out += String(d)));
    child.stderr!.on("data", (d) => (err += String(d)));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout: out, stderr: err });
    });
  });
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
}

function eventDirCount(): number {
  const dir = path.join(root, "data", "events");
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "osm-e2e-"));
  fs.cpSync(path.join(REPO_ROOT, "schemas"), path.join(root, "schemas"), { recursive: true });
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "config", "site.yml"),
    [
      "site:",
      '  name: "Open Science Monitor (e2e fixture)"',
      '  tagline: "test fixture"',
      '  description: "test fixture site"',
      '  repo_url: "https://github.com/example/open-science-monitor"',
      '  pages_url: ""',
      "  language: en",
      "  locale: en-GB",
      "editorial:",
      '  counts_disclaimer: "Counts describe recorded items within the monitored source list."',
    ].join("\n"),
    "utf8",
  );

  server = createServer((req, res) => {
    const route = routes.get(req.url ?? "");
    if (!route) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(route.status, { "content-type": route.type });
    res.end(route.body);
  });
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server!.address();
  port = typeof addr === "object" && addr !== null ? addr.port : 0;

  const feed = (p: string): string => `http://127.0.0.1:${port}${p}`;
  fs.writeFileSync(
    path.join(root, "config", "sources.yml"),
    [
      "coverage:",
      '  scope: "Fixture scope for the Open Science Monitor end-to-end pipeline tests."',
      "  gaps:",
      '    - "no coverage gaps in the test fixture"',
      '  as_of: "2026-11-20"',
      '  how_to_add: "n/a in the e2e fixture"',
      "sources:",
      "  - id: core-rss",
      '    name: "Core Funder News"',
      '    url: "https://core.example.org/"',
      "    kind: funder",
      "    region: Europe",
      "    language: en",
      "    method: rss",
      `    feed: "${feed("/rss")}"`,
      "    enabled: true",
      "    priority: core",
      '    notes: "fixture"',
      "  - id: atom-src",
      '    name: "Atom Watcher"',
      '    url: "https://atom.example.org/"',
      "    kind: initiative",
      "    region: Global",
      "    language: en",
      "    method: atom",
      `    feed: "${feed("/atom")}"`,
      "    enabled: true",
      "    priority: supplementary",
      '    notes: "fixture"',
      "  - id: nodate-src",
      '    name: "Slow Watcher"',
      '    url: "https://nodate.example.org/"',
      "    kind: repository",
      "    region: Europe",
      "    language: en",
      "    method: rss",
      `    feed: "${feed("/nodate")}"`,
      "    enabled: true",
      "    priority: supplementary",
      '    notes: "fixture"',
      "  - id: broken-src",
      '    name: "Broken Source"',
      '    url: "https://broken.example.org/"',
      "    kind: other",
      "    region: Global",
      "    language: en",
      "    method: rss",
      `    feed: "${feed("/broken")}"`,
      "    enabled: true",
      "    priority: supplementary",
      '    notes: "fixture: always returns HTTP 500"',
      "  - id: mal-src",
      '    name: "Malformed Source"',
      '    url: "https://mal.example.org/"',
      "    kind: other",
      "    region: Global",
      "    language: en",
      "    method: rss",
      `    feed: "${feed("/malformed")}"`,
      "    enabled: true",
      "    priority: supplementary",
      '    notes: "fixture: not valid XML"',
    ].join("\n"),
    "utf8",
  );
});

after(() => {
  server?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("a normal weekly run collects, merges, labels and writes every format", async () => {
  setRoute("/rss", xml(RSS_DEFAULT));
  setRoute("/atom", xml(ATOM_DEFAULT));
  setRoute("/nodate", xml(RSS_NODATE));
  setRoute("/broken", { status: 500, body: "boom", type: "text/plain" });
  setRoute("/malformed", { status: 200, body: "<rss><cha", type: "application/xml" });

  const r = await run("scripts/run-issue.ts", ["--week", WEEK, "--root", root]);
  assert.equal(r.status, 0, `run should succeed; stderr: ${r.stderr}`);

  const issue = readJson(path.join(root, "data", "issues", `${WEEK}.json`));
  assert.equal(issue.counts.sources_checked, 5);
  assert.equal(issue.counts.sources_failed, 2);
  assert.equal(issue.counts.items, 3, "2 default items + merged pair counted once + no-date item");
  const items = issue.items as string[];
  assert.equal(new Set(items).size, items.length, "no duplicate items");

  // Broken sources are recorded, not hidden (the PR report shows them).
  const report = readJson(path.join(root, "data", "run-reports", `${WEEK}-run.json`));
  assert.equal(report.status, "ok");
  const failures = report.failures as { id: string; error: string }[];
  assert.deepEqual(failures.map((f) => f.id).sort(), ["broken-src", "mal-src"]);

  // Duplicate coverage merged across feeds: one event, two sources.
  const events = fs.readdirSync(path.join(root, "data", "events")).filter((f) => f.endsWith(".json"));
  assert.equal(events.length, 3, "exactly one event record per merged item, no duplicates");
  const merged = readJson(path.join(root, "data", "events", events.find((f) => f.includes("retention"))!));
  const sources = merged.sources as { source_id: string }[];
  assert.equal(sources.length, 2, "cross-feed echo keeps both sources as coverage");
  assert.deepEqual(sources.map((s) => s.source_id).sort(), ["atom-src", "core-rss"]);

  // Missing publication date: labelled discovered-only, not invented dates.
  const nodate = readJson(path.join(root, "data", "events", events.find((f) => f.includes("consultation"))!));
  const dates = nodate.dates as Record<string, string | null>;
  assert.equal(dates.published, null);
  assert.equal(dates.updated, null);
  assert.match(dates.discovered as string, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(nodate.editorial_status, "pending");
  assert.match(String(nodate.what_changed), /Pending editorial review/);

  // Publication dates that do exist are kept as real dates.
  const ev1 = readJson(path.join(root, "data", "events", events.find((f) => f.includes("coalition"))!));
  assert.equal((ev1.dates as Record<string, string | null>).published, "2026-11-18");

  // All four output formats exist and link absolute source URLs.
  for (const name of ["index.md", "index.html", "substack.md"]) {
    const p = path.join(root, "issues", WEEK, name);
    assert.equal(fs.existsSync(p), true, `${name} must exist`);
    const text = fs.readFileSync(p, "utf8");
    assert.ok(text.trim().length > 200, `${name} must have content`);
  }
  const md = fs.readFileSync(path.join(root, "issues", WEEK, "index.md"), "utf8");
  assert.ok(md.includes("https://example.org/plan-s-update"), "markdown links the primary source");
  const html = fs.readFileSync(path.join(root, "issues", WEEK, "index.html"), "utf8");
  assert.ok(html.includes('href="https://example.org/plan-s-update"'), "html links the primary source");
  const substack = fs.readFileSync(path.join(root, "issues", WEEK, "substack.md"), "utf8");
  assert.ok(substack.includes("https://example.org/consultation-rd"), "substack draft links sources");

  // PR body report lists failures and outputs.
  const prBody = fs.readFileSync(path.join(root, "data", "run-reports", `${WEEK}-pr-body.md`), "utf8");
  assert.ok(prBody.includes("Failed sources"), "PR report names failed sources");
  assert.ok(prBody.includes("broken-src") && prBody.includes("mal-src"));

  // Source status recorded "what this run actually checked".
  const statusFile = readJson(path.join(root, "data", "source-status.json")) as {
    entries: Record<string, Record<string, unknown>>;
  };
  assert.equal(statusFile.entries["broken-src"]!.ok, false);
  assert.equal(statusFile.entries["core-rss"]!.ok, true);
  assert.equal(statusFile.entries["core-rss"]!.last_checked, new Date().toISOString().slice(0, 10));

  // The synthetic tree still passes schema validation.
  const v = await run("scripts/pipeline/validate-data.ts", ["--root", root]);
  assert.equal(v.status, 0, `validate-data should pass: ${v.stderr}`);
});

test("re-running the same week is idempotent (no duplicate events, items or issues)", async () => {
  const beforeCount = eventDirCount();
  const first = readJson(path.join(root, "data", "issues", `${WEEK}.json`)) as { items: string[] };

  const r = await run("scripts/run-issue.ts", ["--week", WEEK, "--root", root]);
  assert.equal(r.status, 0, `re-run should succeed: ${r.stderr}`);

  assert.equal(eventDirCount(), beforeCount, "no new event records for unchanged items");
  const issues = fs.readdirSync(path.join(root, "data", "issues")).filter((f) => f.endsWith(".json"));
  assert.deepEqual(issues, [`${WEEK}.json`], "still exactly one issue file for this week");
  const second = readJson(path.join(root, "data", "issues", `${WEEK}.json`)) as { items: string[] };
  assert.deepEqual(second.items, first.items, "item list stable across re-runs");
});

test("an older story surfacing after the horizon is recorded, not silently shortlisted", async () => {
  // W48 uses W47's cutoff as its horizon (backfill anchor = last published issue).
  const horizon = (readJson(path.join(root, "data", "issues", `${WEEK}.json`)) as {
    run_report: { cutoff: string };
  }).run_report.cutoff;
  assert.equal(horizon, "2026-11-20T07:30:00.000Z", "horizon is the last published cutoff (Berlin Friday)");

  setRoute("/rss", xml(RSS_OLD_RELEVANT));
  setRoute("/atom", xml(RSS_IRRELEVANT_LATE));
  setRoute("/nodate", xml(RSS_IRRELEVANT_LATE));

  const r = await run("scripts/run-issue.ts", ["--week", NEXT_WEEK, "--root", root]);
  assert.equal(r.status, 0, `run should succeed: ${r.stderr}`);

  const issue = readJson(path.join(root, "data", "issues", `${NEXT_WEEK}.json`)) as {
    items: string[];
    summary: string;
    counts: Record<string, number>;
    run_report: { horizon_from: string; not_shortlisted?: { title: string; reason: string }[] };
  };
  assert.equal(issue.items.length, 0, "nothing before the horizon enters the issue");
  assert.equal(issue.counts.sources_checked, 5);
  assert.match(issue.summary, /Quiet week/, "honest quiet-week summary, not a fake thorough issue");
  const notShortlisted = issue.run_report.not_shortlisted ?? [];
  assert.ok(
    notShortlisted.some((n) => n.reason.includes("before the collection window")),
    "the resurfaced older item is explicitly recorded with its reason",
  );
  assert.ok(
    notShortlisted.some((n) => n.reason.includes("no topical match")),
    "off-topic items are recorded as checked but not shortlisted",
  );
});

test("widespread fetch failure reports an error instead of a deceptively thin issue", async () => {
  setRoute("/rss", { status: 503, body: "unavailable", type: "text/plain" });
  setRoute("/atom", { status: 503, body: "unavailable", type: "text/plain" });
  setRoute("/nodate", { status: 503, body: "unavailable", type: "text/plain" });

  const r = await run("scripts/run-issue.ts", ["--week", FAR_WEEK, "--root", root]);
  assert.notEqual(r.status, 0, "the run must fail loudly");
  assert.match(r.stderr, /FATAL/, "operator-facing failure message");
  const report = readJson(path.join(root, "data", "run-reports", `${FAR_WEEK}-run.json`));
  assert.equal(report.status, "failed-collection");
  assert.equal(fs.existsSync(path.join(root, "data", "issues", `${FAR_WEEK}.json`)), false, "no issue file on broad failure");
  assert.equal(fs.existsSync(path.join(root, "issues", FAR_WEEK, "index.md")), false, "no renders on broad failure");
});

test("the static site builds from the synthetic root with archive and issue pages", async () => {
  const outDir = path.join(root, "dist");
  const r = await run("scripts/build-site.ts", ["--root", root, "--out", outDir]);
  assert.equal(r.status, 0, `build should succeed: ${r.stderr}`);
  for (const p of [
    "index.html",
    "archive/index.html",
    "policy-tracker/index.html",
    "sources/index.html",
    "issues/index.html",
    `issues/${WEEK}/index.html`,
    "search-index.json",
  ]) {
    assert.equal(fs.existsSync(path.join(outDir, p)), true, `expected ${p} in the built site`);
  }
  const search = readJson(path.join(outDir, "search-index.json"));
  assert.ok(Array.isArray(search) && search.length >= 3, "search index covers the collected items");

  // The build embeds the shareable URL-filter contract.
  const archiveHtml = fs.readFileSync(path.join(outDir, "archive", "index.html"), "utf8");
  assert.ok(archiveHtml.includes("archive.js"), "archive page loads its filter script");
});

test("the committed repository data still validates and renders identically (clean-checkout guard)", async () => {
  const v = await run("scripts/pipeline/validate-data.ts", []);
  assert.equal(v.status, 0, `repo data should validate: ${v.stderr}`);
  const c = await run("scripts/render-issue-outputs.ts", ["--check"]);
  assert.equal(c.status, 0, `committed renders must match the datasets: ${c.stderr}${c.stdout}`);
  const b = await run("scripts/build-site.ts", ["--out", path.join(root, "repo-dist")]);
  assert.equal(b.status, 0, `repo site should build: ${b.stderr}`);
  assert.equal(fs.existsSync(path.join(root, "repo-dist", "index.html")), true);
  assert.equal(
    fs.existsSync(path.join(root, "repo-dist", "files", "2026-W45", "substack.md")),
    true,
    "downloadable weekly files are copied into the built site",
  );
});
