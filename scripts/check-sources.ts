// Check every catalogue source (enabled and disabled-with-feed) and record
// the result in data/source-status.json. Run on demand and as part of the
// weekly run for the "last checked" column on the Sources page.

import * as fs from "node:fs";
import * as path from "node:path";

import { collectSource } from "./pipeline/collect.ts";
import { todayIso } from "./pipeline/normalize.ts";
import { loadSiteConfig, loadSources, REPO_ROOT, rootFromArg, type SourceStatus } from "./lib/data.ts";

async function main(): Promise<void> {
  const root = rootFromArg(process.argv.slice(2)) || REPO_ROOT;
  const src = loadSources(root);
  if (src.issues.length > 0) {
    for (const i of src.issues) console.error(`${i.path}: ${i.message}`);
    process.exit(1);
  }
  const checkable = src.raw.sources.filter((s) => s.feed && s.method !== "page");
  console.log(`Checking ${checkable.length} feed sources (enabled and disabled)...`);
  loadSiteConfig(root); // smoke-test the site config parse too
  const entries: SourceStatus["entries"] = {};
  for (const s of checkable) {
    const res = await collectSource(s);
    entries[s.id] = {
      ok: res.ok,
      items: res.items.length,
      last_checked: todayIso(),
      ...(res.error ? { error: res.error } : {}),
    };
    console.log(`  ${res.ok ? "OK " : "ERR"} ${s.id}: ${res.ok ? `${res.items.length} items` : res.error}`);
  }
  const file = path.join(root, "data", "source-status.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ as_of: todayIso(), entries }, null, 2) + "\n", "utf8");
  console.log(`Wrote ${path.relative(root, file)}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
