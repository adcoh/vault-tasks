import type { Task } from "./task.js";
import type { SearchHit } from "./search/types.js";

const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const STATUS_DISPLAY: Record<string, string> = {
  open: "open",
  "in-progress": "in-prog",
  done: "done",
  "wont-do": "wont-do",
};

// Use Object.hasOwn rather than `STATUS_DISPLAY[s] ?? s`. A YAML status of
// `constructor`, `toString`, `__proto__`, etc. resolves to an inherited
// Function/Object via the prototype chain, which is truthy → the `??`
// fallback never fires → `.padEnd` then throws TypeError. Hostile input from
// a hand-edited vault would otherwise crash every list/search command.
// The fallback branch ALSO sanitizes — an unknown status like
// `"open\n0099 ..."` would otherwise inject a forged row via the status
// column, sidestepping the per-title sanitization at the row-render site.
function displayStatus(s: string): string {
  return Object.hasOwn(STATUS_DISPLAY, s) ? STATUS_DISPLAY[s] : sanitizeForDisplay(s);
}

// Strip control characters before rendering untrusted task fields into a
// table or error message. Without this, a frontmatter title containing
// `\x1b[31m...` recolors the user's terminal; a title with `\n` or `\t`
// forges fake rows or breaks column alignment. Apply at every interpolation
// site for task-derived strings.
//
// Strategy:
//  - Drop "hard" control bytes (\x00-\x08, \x0b, \x0c, \x0e-\x1f, \x7f-\x9f)
//    entirely — these have no place in a CLI table and exist mainly as
//    attack vectors (ANSI/CSI, ESC, BEL, etc.).
//  - Convert \r, \n, \t to spaces so layout is preserved (rather than
//    silently shortened) when content with line breaks is rendered.
export function sanitizeForDisplay(s: string): string {
  return s
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "")
    .replace(/[\r\n\t]/g, " ");
}

export function sortByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 9;
    const pb = PRIORITY_ORDER[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.created.localeCompare(b.created);
  });
}

export function formatTaskTable(tasks: Task[]): string {
  if (tasks.length === 0) return "No tasks found.";

  // Compute ID column width: max of actual IDs, capped at 10, minimum 4
  const maxIdLen = Math.max(4, ...tasks.map((t) => t.id.length));
  const idWidth = Math.min(maxIdLen, 10);

  const header = `${"ID".padEnd(idWidth)} ${"STATUS".padEnd(10)} ${"PRI".padEnd(8)} ${"CREATED".padEnd(12)} TASK`;
  const divider = "-".repeat(idWidth + 1 + 10 + 1 + 8 + 1 + 12 + 1 + 20);

  const rows = tasks.map((t) => {
    const id = sanitizeForDisplay(t.id).slice(0, idWidth).padEnd(idWidth);
    const status = displayStatus(t.status).padEnd(10);
    const pri = sanitizeForDisplay(t.priority).slice(0, 3).padEnd(8);
    const created = sanitizeForDisplay(t.created || "?").padEnd(12);
    return `${id} ${status} ${pri} ${created} ${sanitizeForDisplay(t.title)}`;
  });

  return [header, divider, ...rows].join("\n");
}

export function formatStaleTable(
  items: Array<{ task: Task; ageDays: number }>
): string {
  if (items.length === 0) return "No stale tasks found.";

  const maxIdLen = Math.max(4, ...items.map(({ task }) => task.id.length));
  const idWidth = Math.min(maxIdLen, 10);

  const header = `${"ID".padEnd(idWidth)} ${"AGE".padEnd(8)} ${"PRI".padEnd(8)} TASK`;
  const divider = "-".repeat(idWidth + 1 + 8 + 1 + 8 + 1 + 20);

  const rows = items.map(({ task, ageDays }) => {
    const id = sanitizeForDisplay(task.id).slice(0, idWidth).padEnd(idWidth);
    const age = String(ageDays).padEnd(8);
    const pri = sanitizeForDisplay(task.priority).slice(0, 3).padEnd(8);
    return `${id} ${age} ${pri} ${sanitizeForDisplay(task.title)}`;
  });

  return [header, divider, ...rows].join("\n");
}

export function formatSearchHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "No matching tasks.";

  const maxIdLen = Math.max(4, ...hits.map((h) => h.task.id.length));
  const idWidth = Math.min(maxIdLen, 10);

  const header = `${"ID".padEnd(idWidth)} ${"SCORE".padEnd(7)} ${"STATUS".padEnd(10)} ${"PRI".padEnd(8)} TASK`;
  const divider = "-".repeat(idWidth + 1 + 7 + 1 + 10 + 1 + 8 + 1 + 20);

  const rows = hits.map(({ task, score }) => {
    const id = sanitizeForDisplay(task.id).slice(0, idWidth).padEnd(idWidth);
    const sc = score.toFixed(2).padEnd(7);
    const status = displayStatus(task.status).padEnd(10);
    const pri = sanitizeForDisplay(task.priority).slice(0, 3).padEnd(8);
    return `${id} ${sc} ${status} ${pri} ${sanitizeForDisplay(task.title)}`;
  });

  return [header, divider, ...rows].join("\n");
}

export function formatTagList(tags: Map<string, number>): string {
  if (tags.size === 0) return "No tags found.";

  const sorted = [...tags.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([tag, count]) => `  ${tag} (${count})`).join("\n");
}
