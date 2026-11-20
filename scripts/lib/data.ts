// Shared filesystem-front helpers: repo root, config loading, data access.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { Issue, Event, Policy, SourceSpec, SourcesFile } from "../../shared/types.ts";
import { validate, type JsonSchema, type ValidationIssue } from "../../shared/validate.ts";
import { parseYaml } from "../pipeline/yaml.ts";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function rootFromArg(argv: string[]): string {
  const i = argv.indexOf("--root");
  return i !== -1 && argv[i + 1] ? path.resolve(argv[i + 1]!) : REPO_ROOT;
}

/** Load and parse a JSON Schema file. */
export function loadSchema(root: string, name: string): JsonSchema {
  return JSON.parse(fs.readFileSync(path.join(root, "schemas", name), "utf8")) as JsonSchema;
}

export interface LoadedSources {
  raw: SourcesFile;
  issues: ValidationIssue[];
}

/** Parse + validate config/sources.yml against the source schema. */
export function loadSources(root: string): LoadedSources {
  const text = fs.readFileSync(path.join(root, "config", "sources.yml"), "utf8");
  const raw = parseYaml(text) as unknown;
  const schema = loadSchema(root, "source.schema.json");
  const issues = validate(raw, schema, "sources.yml");
  if (issues.length > 0) return { raw: raw as SourcesFile, issues };
  return { raw: raw as SourcesFile, issues: [] };
}

export function loadEvents(root: string): Map<string, Event> {
  const dir = path.join(root, "data", "events");
  const map = new Map<string, Event>();
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const ev = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Event;
    map.set(ev.id, ev);
  }
  return map;
}

export function loadIssues(root: string): Issue[] {
  const dir = path.join(root, "data", "issues");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Issue)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function loadPolicies(root: string): Policy[] {
  const dir = path.join(root, "data", "policies");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Policy)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export interface SourceStatus {
  as_of: string;
  entries: Record<string, { ok: boolean; http_status?: string; items?: number; last_checked: string; error?: string }>;
}

export function loadSourceStatus(root: string): SourceStatus | null {
  const p = path.join(root, "data", "source-status.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as SourceStatus;
}

export interface SiteConfig {
  site: {
    name: string;
    tagline: string;
    description: string;
    repo_url: string;
    pages_url: string;
    language: string;
    locale: string;
  };
  editorial: {
    counts_disclaimer: string;
  };
}

export function loadSiteConfig(root: string): SiteConfig {
  const text = fs.readFileSync(path.join(root, "config", "site.yml"), "utf8");
  const raw = parseYaml(text) as SiteConfig;
  const defaults: SiteConfig = {
    site: {
      name: "Open Science Monitor",
      tagline: "",
      description: "",
      repo_url: "",
      pages_url: "",
      language: "en",
      locale: "en-GB",
    },
    editorial: {
      counts_disclaimer:
        "Counts describe items recorded within the monitored source list.",
    },
  };
  return {
    site: { ...defaults.site, ...(raw.site ?? {}) },
    editorial: { ...defaults.editorial, ...(raw.editorial ?? {}) },
  };
}

export function sourcesById(raw: SourcesFile): Map<string, SourceSpec> {
  return new Map(raw.sources.map((s) => [s.id, s]));
}
