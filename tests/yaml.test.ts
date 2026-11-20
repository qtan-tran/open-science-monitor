// YAML subset parser tests + integration check against the real catalogue.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { parseYaml } from "../scripts/pipeline/yaml.ts";
import { loadSources } from "../scripts/lib/data.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("parses quoted sequence scalars containing colons", () => {
  const y = parseYaml([
    "coverage:",
    "  gaps:",
    '    - "Africa coverage is weak: no verified feeds yet"',
    "    - \"LIBER returns 403 to our fetcher: needs a tailored strategy\"",
  ].join("\n")) as { coverage: { gaps: string[] } };
  assert.equal(y.coverage.gaps.length, 2);
  assert.match(y.coverage.gaps[0]!, /^Africa coverage is weak:/);
  assert.match(y.coverage.gaps[1]!, /403/);
});

test("coerces unquoted booleans and integers, keeps quoted ones as strings", () => {
  const y = parseYaml([
    "sources:",
    "  - id: a",
    "    enabled: true",
    "    count: 3",
    "    label: \"true\"",
  ].join("\n")) as { sources: Record<string, unknown>[] };
  assert.equal(y.sources[0]!.enabled, true);
  assert.equal(typeof y.sources[0]!.enabled, "boolean");
  assert.equal(y.sources[0]!.count, 3);
  assert.equal(y.sources[0]!.label, "true"); // quoted stays a string
});

test("parses sequences of mappings with continuation keys at the item column", () => {
  const y = parseYaml([
    "sources:",
    "  - id: one",
    "    name: First",
    "    nested:",
    "      deep: value",
    "      list:",
    "        - a",
    "        - b",
    "  - id: two",
    "    name: Second",
  ].join("\n")) as { sources: { id: string; name: string; nested?: { deep: string; list: string[] } }[] };
  assert.equal(y.sources.length, 2);
  assert.equal(y.sources[0]!.id, "one");
  assert.equal(y.sources[1]!.name, "Second");
  assert.deepEqual(y.sources[0]!.nested!.list, ["a", "b"]);
  assert.equal(y.sources[0]!.nested!.deep, "value");
});

test("ignores comments and strips clearly separated trailing comments", () => {
  const y = parseYaml([
    "# leading comment",
    "key: value # trailing comment",
    "another: \"has # inside\"",
    "# full-line comment",
    "plain: text",
  ].join("\n")) as Record<string, string>;
  assert.equal(y.key, "value");
  assert.equal(y.another, "has # inside");
  assert.equal(y.plain, "text");
});

test("throws with a line number on malformed input", () => {
  assert.throws(() => parseYaml("just text without a colon"), /line 1/);
  assert.throws(() => parseYaml("key: value\nnonsense line here"), /line 2/);
  assert.throws(() => parseYaml("key: \"unterminated"), /unterminated/);
});

test("the real config/sources.yml parses and passes its schema", () => {
  const loaded = loadSources(REPO_ROOT);
  assert.deepEqual(loaded.issues, []);
  const src = loaded.raw;
  assert.ok(src.sources.length >= 18, "expected at least 18 catalogue entries");
  const ids = new Set(src.sources.map((s) => s.id));
  assert.equal(ids.size, src.sources.length, "source ids must be unique");
  const enabled = src.sources.filter((s) => s.enabled);
  for (const s of enabled) {
    assert.ok(/^https?:\/\//.test(s.feed ?? ""), `enabled source ${s.id} must have an http(s) feed`);
  }
  assert.ok(Array.isArray(src.coverage.gaps) && src.coverage.gaps.length > 0, "gaps must be documented");
});
