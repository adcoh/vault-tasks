/**
 * Minimal YAML frontmatter parser/writer.
 * Zero dependencies — handles the subset of YAML used in task files.
 *
 * Quoting rules:
 * - String values containing YAML-special characters are double-quoted
 * - Double-quoted values support escape sequences: \\, \", \n, \t
 * - Empty arrays are written as `key: []`
 * - Null/undefined values are omitted
 */

/** Characters that require double-quoting in a YAML value. */
const YAML_SPECIAL = /[:#{}\[\]"'`|>!&*@,?\\]/;

/** YAML boolean/null literals that must be quoted to remain strings. */
const YAML_RESERVED = new Set([
  "true", "false", "null", "yes", "no", "on", "off",
  "True", "False", "Null", "Yes", "No", "On", "Off",
  "TRUE", "FALSE", "NULL", "YES", "NO", "ON", "OFF",
]);

/**
 * Quote a string value for safe YAML output if it contains special characters.
 * Returns the value unquoted when safe.
 */
function yamlQuote(value: string): string {
  if (value === "") return "";
  if (
    YAML_SPECIAL.test(value) ||
    YAML_RESERVED.has(value) ||
    /^-?\d+(\.\d+)?$/.test(value) ||
    /^0[xXoObB]/.test(value) ||
    value.startsWith("- ") ||
    value.startsWith(" ") ||
    value.endsWith(" ") ||
    value.includes("\n")
  ) {
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t");
    return `"${escaped}"`;
  }
  return value;
}

/**
 * Unquote a YAML value, handling escape sequences for double-quoted strings
 * and '' escaping for single-quoted strings.
 */
function unquoteValue(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\(.)/g, (_: string, ch: string) => {
      switch (ch) {
        case "n": return "\n";
        case "t": return "\t";
        case '"': return '"';
        case "\\": return "\\";
        default: return ch;
      }
    });
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

export function parseFrontmatter(
  text: string
): { meta: Record<string, unknown>; body: string } {
  // Normalize CRLF → LF
  const normalized = text.replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---")) {
    return { meta: {}, body: normalized };
  }

  // Find the end of the opening `---` line
  const openEnd = normalized.indexOf("\n", 3);
  if (openEnd === -1) {
    return { meta: {}, body: normalized };
  }

  // Find closing `---` on its own line (not just any `---` substring)
  const rest = normalized.slice(openEnd);
  const closeMatch = /\n---[ \t]*(\n|$)/.exec(rest);
  if (!closeMatch) {
    return { meta: {}, body: normalized };
  }

  const fmBlock = normalized.slice(openEnd + 1, openEnd + closeMatch.index);
  const bodyStart = openEnd + closeMatch.index + closeMatch[0].length;
  const body = normalized.slice(bodyStart);

  const meta: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const line of fmBlock.split("\n")) {
    // List item (e.g. "  - value")
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      if (currentList === null) {
        currentList = [];
      }
      currentList.push(unquoteValue(listMatch[1].trim()));
      meta[currentKey] = currentList;
      continue;
    }

    // Key-value pair — allow dots, hyphens, underscores in keys
    const kvMatch = line.match(/^([\w][\w.\-]*):\s*(.*)$/);
    if (kvMatch) {
      if (currentList !== null) {
        currentList = null;
      }

      currentKey = kvMatch[1];
      const rawValue = kvMatch[2].trim();

      // Empty array: []
      if (rawValue === "[]") {
        meta[currentKey] = [];
        currentList = [];
        continue;
      }

      // Inline list: [tag1, tag2] — but not wikilinks [[like this]]
      const inlineList = rawValue.match(/^\[(.+)\]$/);
      if (inlineList && !rawValue.startsWith("[[")) {
        const items = inlineList[1]
          .split(",")
          .map((v) => unquoteValue(v.trim()));
        meta[currentKey] = items;
        currentList = items;
      } else if (rawValue) {
        meta[currentKey] = unquoteValue(rawValue);
      } else {
        // Value might be a list on following lines
        meta[currentKey] = "";
        currentList = null;
      }
    }
  }

  return { meta, body };
}

export function writeFrontmatter(
  meta: Record<string, unknown>,
  body: string
): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(meta)) {
    // Skip null/undefined
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${yamlQuote(String(item))}`);
        }
      }
    } else {
      lines.push(`${key}: ${yamlQuote(String(value))}`);
    }
  }

  lines.push("---");
  lines.push("");
  return lines.join("\n") + body;
}
