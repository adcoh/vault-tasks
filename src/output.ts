import type { Task } from "./task.js";

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

  const header = `${"ID".padEnd(6)} ${"STATUS".padEnd(10)} ${"PRI".padEnd(8)} ${"CREATED".padEnd(12)} TASK`;
  const divider = "-".repeat(70);

  const rows = tasks.map((t) => {
    const id = String(t.id).padEnd(6);
    const status = (STATUS_DISPLAY[t.status] ?? t.status).padEnd(10);
    const pri = t.priority.slice(0, 3).padEnd(8);
    const created = (t.created || "?").padEnd(12);
    return `${id} ${status} ${pri} ${created} ${t.title}`;
  });

  return [header, divider, ...rows].join("\n");
}

export function formatStaleTable(
  items: Array<{ task: Task; ageDays: number }>
): string {
  if (items.length === 0) return "No stale tasks found.";

  const header = `${"ID".padEnd(6)} ${"AGE".padEnd(8)} ${"PRI".padEnd(8)} TASK`;
  const divider = "-".repeat(60);

  const rows = items.map(({ task, ageDays }) => {
    const id = String(task.id).padEnd(6);
    const age = String(ageDays).padEnd(8);
    const pri = task.priority.slice(0, 3).padEnd(8);
    return `${id} ${age} ${pri} ${task.title}`;
  });

  return [header, divider, ...rows].join("\n");
}

export function formatTagList(tags: Map<string, number>): string {
  if (tags.size === 0) return "No tags found.";

  const sorted = [...tags.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([tag, count]) => `  ${tag} (${count})`).join("\n");
}
