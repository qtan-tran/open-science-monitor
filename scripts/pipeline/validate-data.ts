// Validate every data file against its schema, plus cross-file integrity
// checks. Run before rendering, before building the site, and in CI.

import * as fs from "node:fs";
import * as path from "node:path";

import type { Event, Issue, Policy } from "../../shared/types.ts";
import { validate, type ValidationIssue } from "../../shared/validate.ts";
import { loadEvents, loadIssues, loadPolicies, loadSchema, loadSources, REPO_ROOT, rootFromArg, sourcesById } from "../lib/data.ts";

export interface CrossIssue {
  file: string;
  message: string;
}

export function validateDataTree(root: string): { schema: ValidationIssue[]; cross: CrossIssue[] } {
  const schemaIssues: ValidationIssue[] = [];
  const cross: CrossIssue[] = [];

  const src = loadSources(root);
  schemaIssues.push(...src.issues);
  const sourceIds = new Set(src.raw.sources.map((s) => s.id));

  const eventSchema = loadSchema(root, "event.schema.json");
  const policySchema = loadSchema(root, "policy.schema.json");
  const issueSchema = loadSchema(root, "issue.schema.json");

  const events = loadEvents(root);
  for (const [id, ev] of events) {
    const iss = validate(ev, eventSchema, `events/${id}.json`);
    schemaIssues.push(...iss);
  }
  for (const ev of events.values()) {
    for (const s of ev.sources) {
      if (s.source_id && !sourceIds.has(s.source_id)) {
        cross.push({
          file: `data/events/${ev.id}.json`,
          message: `event source_id "${s.source_id}" is not in the source catalogue`,
        });
      }
    }
    if (ev.supersedes && !events.has(ev.supersedes)) {
      cross.push({
        file: `data/events/${ev.id}.json`,
        message: `supersedes unknown event "${ev.supersedes}"`,
      });
    }
    if (ev.policy_id) {
      const polPath = path.join(root, "data", "policies", `${ev.policy_id}.json`);
      if (!fs.existsSync(polPath)) {
        cross.push({
          file: `data/events/${ev.id}.json`,
          message: `references unknown policy "${ev.policy_id}"`,
        });
      }
    }
  }

  const policiesDir = path.join(root, "data", "policies");
  const policies = fs.existsSync(policiesDir)
    ? fs
        .readdirSync(policiesDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(fs.readFileSync(path.join(policiesDir, f), "utf8")) as Policy)
    : [];
  for (const p of policies) {
    schemaIssues.push(...validate(p, policySchema, `policies/${p.id}.json`));
    if (p.verified === true) {
      for (const m of p.milestones) {
        if (!m.verified) {
          cross.push({
            file: `data/policies/${p.id}.json`,
            message: `policy marked verified but milestone "${m.label}" is unverified`,
          });
        }
      }
    }
  }

  const issues = loadIssues(root);
  for (const issue of issues) {
    schemaIssues.push(...validate(issue, issueSchema, `issues/${issue.id}.json`));
    for (const evId of issue.items) {
      const ev = events.get(evId);
      if (!ev) {
        cross.push({
          file: `data/issues/${issue.id}.json`,
          message: `references unknown event "${evId}"`,
        });
        continue;
      }
      if (!ev.appearances.includes(issue.id)) {
        cross.push({
          file: `data/issues/${issue.id}.json`,
          message: `event "${evId}" is missing appearance "${issue.id}"`,
        });
      }
    }
    if (issue.paths.markdown !== `issues/${issue.id}/index.md`) {
      cross.push({ file: `data/issues/${issue.id}.json`, message: `paths.markdown mismatch` });
    }
  }

  return { schema: schemaIssues, cross };
}

function main(): void {
  const root = rootFromArg(process.argv.slice(2)) || REPO_ROOT;
  const { schema, cross } = validateDataTree(root);
  for (const i of schema) console.error(`SCHEMA ${i.path}: ${i.message}`);
  for (const c of cross) console.error(`CROSS ${c.file}: ${c.message}`);
  const total = schema.length + cross.length;
  if (total > 0) {
    console.error(`${total} data validation issue(s).`);
    process.exit(1);
  }
  console.log("Data tree valid: sources, events, policies, issues all pass schema + cross checks.");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("validate-data.ts")) {
  main();
}
