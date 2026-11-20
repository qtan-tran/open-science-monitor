// Minimal JSON Schema (draft-07 subset) validator, so the project validates
// data before rendering/building without external dependencies.
//
// Supported keywords: definitions/$defs (local), $ref (local only), type,
// required, properties, items, enum, pattern, format (date, date-time, uri),
// minItems, additionalProperties (boolean or schema).

export interface JsonSchema {
  [k: string]: unknown;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "number") return Number.isInteger(v) ? "integer" : "number";
  return t; // string, boolean, object
}

function matchesType(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  if (t === "number") return actual === "number" || actual === "integer";
  if (t === "integer") return actual === "integer";
  return actual === t;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?([+-]\d{2}:?\d{2}|Z)$/;

export function validate(value: unknown, schema: JsonSchema, path = "$"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const defs = (schema.definitions ?? schema.$defs ?? {}) as Record<string, JsonSchema>;

  const check = (v: unknown, s: JsonSchema, p: string): void => {
    // Local $ref resolution only, with optional sibling keywords.
    if (typeof s.$ref === "string") {
      const m = /^#\/(?:definitions|\$defs)\/(.+)$/.exec(s.$ref);
      if (!m || !defs[m[1]!]) {
        issues.push({ path: p, message: `unresolvable $ref ${String(s.$ref)}` });
        return;
      }
      check(v, defs[m[1]]!, p);
      const siblings: JsonSchema = { ...s };
      delete siblings.$ref;
      delete siblings.definitions;
      delete siblings.$defs;
      if (Object.keys(siblings).length > 0) check(v, siblings, p);
      return;
    }

    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
      if (!types.some((t) => matchesType(v, t))) {
        issues.push({ path: p, message: `expected type ${types.join("|")}, got ${typeOf(v)}` });
        return;
      }
    }

    if (s.enum !== undefined && !(s.enum as unknown[]).some((e) => e === v)) {
      issues.push({ path: p, message: `not in enum: ${JSON.stringify(v)}` });
    }
    if (typeof s.pattern === "string" && typeof v === "string") {
      if (!new RegExp(s.pattern).test(v)) {
        issues.push({ path: p, message: `does not match pattern ${s.pattern}` });
      }
    }
    if (typeof s.format === "string") {
      if (s.format === "date" && typeof v === "string" && !ISO_DATE.test(v)) {
        issues.push({ path: p, message: `not an ISO date: ${v}` });
      }
      if (s.format === "date-time" && typeof v === "string" && !ISO_INSTANT.test(v)) {
        issues.push({ path: p, message: `not an ISO instant: ${v}` });
      }
      if (s.format === "uri" && typeof v === "string" && !/^https?:\/\//.test(v)) {
        issues.push({ path: p, message: `not an http(s) URI: ${v}` });
      }
    }

    if (Array.isArray(v)) {
      const minItems = s.minItems as number | undefined;
      if (typeof minItems === "number" && v.length < minItems) {
        issues.push({ path: p, message: `needs at least ${minItems} items` });
      }
      if (s.items && typeof s.items === "object" && !Array.isArray(s.items)) {
        v.forEach((el, i) => check(el, s.items as JsonSchema, `${p}[${i}]`));
      }
    }

    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      const props = (s.properties ?? {}) as Record<string, JsonSchema>;
      for (const req of ((s.required as string[] | undefined) ?? [])) {
        if (!(req in obj)) {
          issues.push({ path: p, message: `missing required property "${req}"` });
        }
      }
      const additional = s.additionalProperties;
      for (const [k, val] of Object.entries(obj)) {
        if (props[k]) {
          check(val, props[k]!, `${p}.${k}`);
        } else if (additional === false) {
          issues.push({ path: p, message: `unexpected property "${k}"` });
        } else if (additional && typeof additional === "object") {
          check(val, additional as JsonSchema, `${p}.${k}`);
        }
      }
    }
  };

  check(value, schema, path);
  return issues;
}
