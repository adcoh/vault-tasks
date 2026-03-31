/**
 * Minimal YAML frontmatter parser/writer.
 * Zero dependencies — handles the subset of YAML used in task files.
 */

export function parseFrontmatter(
  text: string
): { meta: Record<string, unknown>; body: string } {
  if (!text.startsWith("---")) {
    return { meta: {}, body: text };
  }

  const parts = text.split("---");
  if (parts.length < 3) {
    return { meta: {}, body: text };
  }

  // parts[0] is empty (before first ---), parts[1] is frontmatter, parts[2+] is body
  const fmBlock = parts[1];
  const body = parts.slice(2).join("---").replace(/^\n+/, "");

  const meta: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const line of fmBlock.trim().split("\n")) {
    // List item (e.g. "  - cv")
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      if (currentList === null) {
        currentList = [];
      }
      currentList.push(listMatch[1].trim());
      meta[currentKey] = currentList;
      continue;
    }

    // Key-value pair
    const kvMatch = line.match(/^([\w][\w-]*):\s*(.*)$/);
    if (kvMatch) {
      if (currentList !== null) {
        currentList = null;
      }

      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();

      // Inline list: [tag1, tag2]
      const inlineList = value.match(/^\[(.+)\]$/);
      if (inlineList) {
        const items = inlineList[1].split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
        meta[currentKey] = items;
        currentList = items;
      } else if (value) {
        meta[currentKey] = value.replace(/^["']|["']$/g, "");
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
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push("---");
  lines.push("");
  return lines.join("\n") + body;
}
