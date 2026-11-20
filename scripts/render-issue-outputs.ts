// Re-render the committed outputs (issues/<week>/...) from the datasets in
// data/issues + data/events. Used in CI to verify the committed Markdown,
// HTML and Substack drafts are exactly what the current renderer produces,
// and locally to refresh formats after an editorial edit.

import * as fs from "node:fs";
import * as path from "node:path";

import { loadEvents, loadIssues, loadSiteConfig, REPO_ROOT, rootFromArg } from "./lib/data.ts";
import { renderIssueHtml, renderIssueMarkdown, renderIssueSubstack } from "./pipeline/render.ts";

function main(): void {
  const root = rootFromArg(process.argv.slice(2)) || REPO_ROOT;
  const cfg = loadSiteConfig(root);
  const events = loadEvents(root);
  const issues = loadIssues(root);
  for (const issue of issues) {
    const issueEvents = issue.items.map((id) => events.get(id)).filter((e) => e !== undefined);
    const dir = path.join(root, "issues", issue.id);
    const opts = { siteName: cfg.site.name, repoUrl: cfg.site.repo_url };
    const files: [string, string][] = [
      ["index.md", renderIssueMarkdown(issue, issueEvents, opts)],
      ["index.html", renderIssueHtml(issue, issueEvents, opts)],
      ["substack.md", renderIssueSubstack(issue, issueEvents)],
    ];
    for (const [name, content] of files) {
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, name);
      if (process.argv.includes("--check")) {
        if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== content) {
          console.error(`STALE OR MISSING: issues/${issue.id}/${name} does not match the dataset.`);
          process.exit(1);
        }
      } else {
        fs.writeFileSync(p, content, "utf8");
      }
    }
    console.log(
      `rendered issues/${issue.id}/{index.md,index.html,substack.md} (${issue.counts.items} items)`,
    );
  }
  console.log(`Rendered ${issues.length} issue(s)${process.argv.includes("--check") ? " (check mode)" : ""}.`);
}

main();
