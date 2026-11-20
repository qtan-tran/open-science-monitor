// Minimal YAML subset parser for config files in this project.
//
// Supported syntax (sufficient for config/sources.yml and config/site.yml):
//   - comments starting the line with '#'
//   - nested mappings via indentation
//   - sequences of scalars ("- value")
//   - sequences of mappings ("- key: value" + continued keys at key indent)
//   - scalars: plain or quoted with " or '
// Not supported: anchors, multiline block scalars, flow style, tags.
// The parser throws with a line number on anything it cannot handle;
// downstream schema validation catches semantic problems.

export interface YamlLine {
  indent: number;
  content: string;
  no: number;
}

interface YamlError extends Error {
  line?: number;
}

function err(msg: string, no?: number): never {
  const e = new Error(`YAML parse error at line ${no ?? "?"}: ${msg}`) as YamlError;
  e.line = no;
  throw e;
}

function tokenize(text: string): YamlLine[] {
  const out: YamlLine[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "" || /^\s*#/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    out.push({ indent, content: raw.trim(), no: i + 1 });
  }
  return out;
}

function scalar(t: string): string | number | boolean {
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  return t;
}

function unquote(v: string, no: number): string | number | boolean {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (t.startsWith('"') || t.startsWith("'")) {
    err(`unterminated quoted scalar: ${t}`, no);
  }
  // Strip trailing comment only when clearly separated: " # "
  const m = /^(.*?\S)\s+#\s/.exec(t);
  if (m) {
    return scalar(m[1]!.trim());
  }
  return scalar(t);
}

/** Split "key: value" / "key:" (key must not contain ':' before the split). */
export function splitKeyValue(content: string, no: number): { key: string; value: string } {
  const idx = content.indexOf(":");
  if (idx <= 0) err(`expected "key: value", got: ${content}`, no);
  let key = content.slice(0, idx).trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  if (key === "") err("empty key", no);
  const value = content.slice(idx + 1).trim();
  return { key, value };
}

/**
 * Parse the supported YAML subset. `rootIndent` is the column all entries of
 * the current block start at.
 */
function parseBlock(lines: YamlLine[], state: { i: number }, rootIndent: number): unknown {
  if (state.i >= lines.length) return null;
  const first = lines[state.i]!;

  if (first.content.startsWith("- ") || first.content === "-") {
    // Sequence block.
    const seq: unknown[] = [];
    while (state.i < lines.length) {
      const line = lines[state.i]!;
      if (line.indent !== rootIndent || !(line.content.startsWith("- ") || line.content === "-")) {
        break;
      }
      const rest = line.content === "-" ? "" : line.content.slice(2);
      if (rest === "") {
        // "- " followed by a nested block on following lines.
        state.i++;
        if (
          state.i < lines.length &&
          lines[state.i]!.indent > rootIndent
        ) {
          seq.push(parseBlock(lines, state, lines[state.i]!.indent));
        } else {
          seq.push(null);
        }
        continue;
      }
      // A quoted scalar may contain colons; treat it as a plain item.
      const q = /^"(?:[^"\\]|\\.)*"$/.test(rest) || /^'[^']*'$/.test(rest);
      const kv = q ? null : /^([^:]+):\s*(.*)$/.exec(rest);
      if (kv) {
        // "- key: value" starts a mapping item; following keys sit at
        // the column where the first key started.
        const keyCol = rootIndent + 2 + (rest.length - rest.trimStart().length);
        const map: Record<string, unknown> = {};
        const rawKey = kv[1] ?? "";
        const { key } = splitKeyValue(rawKey.concat(":"), line.no);
        const value = (kv[2] ?? "").trim();
        if (value === "") {
          state.i++;
          if (
            state.i < lines.length &&
            lines[state.i]!.indent > keyCol
          ) {
            map[key] = parseBlock(lines, state, lines[state.i]!.indent);
          } else {
            map[key] = null;
          }
        } else {
          map[key] = unquote(value, line.no);
          state.i++;
        }
        while (state.i < lines.length) {
          const cont = lines[state.i]!;
          if (cont.indent !== keyCol || cont.content.startsWith("- ")) break;
          const { key: k2, value: v2 } = splitKeyValue(cont.content, cont.no);
          if (v2 === "") {
            state.i++;
            if (state.i < lines.length && lines[state.i]!.indent > keyCol) {
              map[k2] = parseBlock(lines, state, lines[state.i]!.indent);
            } else {
              map[k2] = null;
            }
          } else {
            map[k2] = unquote(v2, cont.no);
            state.i++;
          }
        }
        seq.push(map);
        continue;
      }
      // Plain scalar item.
      seq.push(unquote(rest, line.no));
      state.i++;
    }
    return seq;
  }

  // Mapping block.
  const map: Record<string, unknown> = {};
  while (state.i < lines.length) {
    const line = lines[state.i]!;
    if (line.indent !== rootIndent) break;
    if (line.content.startsWith("- ")) break;
    const { key, value } = splitKeyValue(line.content, line.no);
    if (value === "") {
      state.i++;
      if (state.i < lines.length && lines[state.i]!.indent > rootIndent) {
        map[key] = parseBlock(lines, state, lines[state.i]!.indent);
      } else {
        map[key] = null;
      }
    } else {
      map[key] = unquote(value, line.no);
      state.i++;
    }
  }
  return map;
}

export function parseYaml(text: string): unknown {
  const lines = tokenize(text);
  if (lines.length === 0) return null;
  const state = { i: 0 };
  return parseBlock(lines, state, lines[0]!.indent);
}
