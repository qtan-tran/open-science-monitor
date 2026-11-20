// JSON Schema subset validator tests + full validation of the repository data tree.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { validate } from "../shared/validate.ts";
import { loadEvents, loadIssues, loadPolicies, loadSchema, loadSources } from "../scripts/lib/data.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The hand-seeded demo weeks predate the live pipeline; they must stay visibly
// marked as samples so nobody mistakes them for real output. Issues produced
// by the pipeline (e.g. status "draft") are NOT samples and are covered by
// the schema checks above.
const SEED_WEEKS = ["2026-W42", "2026-W43", "2026-W44", "2026-W45"];

test("validator catches type, required, enum, pattern, format and additionalProperties", () => {
  const schema = {
    type: "object",
    required: ["id", "status"],
    additionalProperties: false,
    properties: {
      id: { type: "string", pattern: "^[a-z]+$" },
      status: { enum: ["new", "updated"] },
      day: { type: "string", format: "date" },
      at: { type: "string", format: "date-time" },
      link: { type: "string", format: "uri" },
      tags: { type: "array", minItems: 1, items: { type: "string" } },
      note: { type: ["string", "null"] },
    },
  };
  const good = { id: "abc", status: "new", day: "2026-11-20", at: "2026-11-20T07:30:00Z", link: "https://x.org", tags: ["a"], note: null };
  assert.deepEqual(validate(good, schema), []);

  const bad = { id: "ABC", status: "retired", day: "20/11/2026", at: "yesterday", link: "nope", tags: [], note: 5, extra: true };
  const issues = validate(bad, schema, "$");
  const msgs = issues.map((i) => i.message).join("\n");
  assert.ok(issues.length >= 6, `expected many issues, got: ${msgs}`);
  assert.ok(msgs.includes("pattern"), "pattern violations reported");
  assert.ok(msgs.includes("not in enum") || msgs.includes("enum"), "enum violations reported");
  assert.ok(msgs.includes("not an ISO date") || msgs.includes("not an ISO instant") || msgs.includes("not an http"), "format violations reported");
  assert.ok(msgs.includes("at least 1 items") || msgs.includes("needs at least"), "minItems reported");
  assert.ok(msgs.includes('unexpected property "extra"'), "additionalProperties reported");
  assert.ok(
    validate({ id: "abc" }, schema)[0]!.message.includes("missing required property \"status\""),
    "required naming",
  );
});

test("validator flags a boolean given as string (the exact regression class)", () => {
  const issues = validate({ enabled: "true" }, { type: "object", properties: { enabled: { type: "boolean" } } });
  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /expected type boolean, got string/);
});

test("the whole committed data tree passes its schemas", () => {
  const eventSchema = loadSchema(REPO_ROOT, "event.schema.json");
  const issueSchema = loadSchema(REPO_ROOT, "issue.schema.json");
  const policySchema = loadSchema(REPO_ROOT, "policy.schema.json");

  const problems: string[] = [];

  for (const [id, ev] of loadEvents(REPO_ROOT)) {
    problems.push(...validate(ev, eventSchema, `event ${id}`).map((i) => `${id}: ${i.message}`));
  }
  for (const issue of loadIssues(REPO_ROOT)) {
    problems.push(...validate(issue, issueSchema, `issue ${issue.id}`).map((i) => `${issue.id}: ${i.message}`));
    for (const itemId of issue.items) {
      // every issue item must resolve to exactly one registered event
      if (!fs.existsSync(path.join(REPO_ROOT, "data", "events", `${itemId}.json`))) {
        problems.push(`${issue.id}: item ${itemId} has no event record`);
      }
    }
    // sample issues must say they are samples (seed weeks only)
    if (SEED_WEEKS.includes(issue.id) && issue.sample !== true) {
      problems.push(`${issue.id}: expected sample: true in the seed data`);
    }
  }
  for (const p of loadPolicies(REPO_ROOT)) {
    problems.push(...validate(p, policySchema, `policy ${p.id}`).map((i) => `${p.id}: ${i.message}`));
  }
  const sources = loadSources(REPO_ROOT);
  problems.push(...sources.issues.map((i) => `sources.yml: ${i.message}`));

  assert.deepEqual(problems, []);
});
