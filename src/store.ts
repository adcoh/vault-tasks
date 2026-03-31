import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative } from "node:path";
import type { Config } from "./config.js";
import { formatId, getNextId } from "./counter.js";
import { parseFrontmatter, writeFrontmatter } from "./frontmatter.js";
import { slugify } from "./slugify.js";
import type { CreateTaskOpts, Task } from "./task.js";

const KNOWN_META_KEYS = new Set([
  "title",
  "status",
  "priority",
  "tags",
  "created",
  "source",
]);

function fileToTask(filePath: string, text: string): Task {
  const { meta, body } = parseFrontmatter(text);
  const name = basename(filePath) ?? "";
  const stem = name.replace(/\.md$/, "");
  const idMatch = name.match(/^(\d+)-/);

  const extraMeta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!KNOWN_META_KEYS.has(k)) {
      extraMeta[k] = v;
    }
  }

  const rawTags = meta["tags"];
  let tags: string[];
  if (Array.isArray(rawTags)) {
    tags = rawTags.map(String);
  } else if (typeof rawTags === "string" && rawTags) {
    tags = [rawTags];
  } else {
    tags = [];
  }

  return {
    id: idMatch ? parseInt(idMatch[1], 10) : 0,
    title: (meta["title"] as string) ?? stem,
    status: (meta["status"] as string) ?? "open",
    priority: (meta["priority"] as string) ?? "medium",
    tags,
    created: (meta["created"] as string) ?? "",
    source: (meta["source"] as string) ?? "",
    body,
    filePath,
    slug: stem,
    extraMeta,
  };
}

function taskToMarkdown(task: Task): string {
  const meta: Record<string, unknown> = {
    title: task.title,
    status: task.status,
    priority: task.priority,
    tags: task.tags,
    created: task.created,
    source: task.source,
    ...task.extraMeta,
  };
  return writeFrontmatter(meta, task.body);
}

export class TaskStore {
  constructor(public readonly config: Config) {}

  private ensureBacklogDir(): void {
    if (!existsSync(this.config.backlogDir)) {
      mkdirSync(this.config.backlogDir, { recursive: true });
    }
  }

  private ensureArchiveDir(): void {
    if (!existsSync(this.config.archiveDir)) {
      mkdirSync(this.config.archiveDir, { recursive: true });
    }
  }

  private listMdFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => join(dir, f));
  }

  create(opts: CreateTaskOpts): Task {
    this.ensureBacklogDir();

    const title = opts.title;
    const priority = opts.priority ?? this.config.defaultPriority;
    const tags = opts.tags ?? [];
    const source = opts.source ?? "";
    const body = opts.body ?? `# ${title}\n\n`;

    if (!this.config.priorities.includes(priority)) {
      throw new Error(
        `Invalid priority: ${priority}. Use: ${this.config.priorities.join(", ")}`
      );
    }

    const today = new Date().toISOString().slice(0, 10);

    // Retry ID allocation on collision (concurrent task creation)
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const id = getNextId(this.config);
      const idStr = formatId(id, this.config);
      const slug = slugify(title, this.config.slugMaxLength);
      const filename = `${idStr}-${slug}.md`;
      const filePath = join(this.config.backlogDir, filename);

      const task: Task = {
        id,
        title,
        status: this.config.defaultStatus,
        priority,
        tags,
        created: today,
        source,
        body,
        filePath,
        slug: `${idStr}-${slug}`,
        extraMeta: {},
      };

      // Exclusive create — fails if file already exists (ID collision)
      try {
        const fd = openSync(filePath, "wx");
        writeFileSync(fd, taskToMarkdown(task), "utf-8");
        closeSync(fd);
        return task;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          continue; // ID collision, retry with next ID
        }
        throw err;
      }
    }

    throw new Error("Failed to allocate unique task ID after retries");
  }

  loadAll(includeArchived = false): Task[] {
    this.ensureBacklogDir();
    const files = this.listMdFiles(this.config.backlogDir);
    const tasks = files.map((f) => fileToTask(f, readFileSync(f, "utf-8")));

    if (includeArchived) {
      const archived = this.listMdFiles(this.config.archiveDir);
      tasks.push(...archived.map((f) => fileToTask(f, readFileSync(f, "utf-8"))));
    }

    return tasks;
  }

  find(identifier: string): Task {
    this.ensureBacklogDir();
    const files = this.listMdFiles(this.config.backlogDir);

    // Try numeric ID first
    const numId = parseInt(identifier, 10);
    if (!isNaN(numId)) {
      const prefix = String(numId).padStart(this.config.padWidth, "0") + "-";
      const match = files.find((f) => basename(f)?.startsWith(prefix));
      if (match) {
        return fileToTask(match, readFileSync(match, "utf-8"));
      }
    }

    // Substring match on filename
    const query = identifier.toLowerCase();
    const matches = files.filter((f) => {
      const name = basename(f)?.replace(/\.md$/, "") ?? "";
      return name.toLowerCase().includes(query);
    });

    if (matches.length === 1) {
      return fileToTask(matches[0], readFileSync(matches[0], "utf-8"));
    }
    if (matches.length === 0) {
      throw new Error(`No task matching '${identifier}'`);
    }

    const names = matches.map((m) => basename(m));
    throw new Error(
      `Ambiguous match for '${identifier}':\n${names.map((n) => `  ${n}`).join("\n")}`
    );
  }

  setStatus(identifier: string, newStatus: string): Task {
    if (!this.config.statuses.includes(newStatus)) {
      throw new Error(
        `Invalid status: ${newStatus}. Use: ${this.config.statuses.join(", ")}`
      );
    }

    const task = this.find(identifier);
    const oldStatus = task.status;
    task.status = newStatus;
    writeFileSync(task.filePath, taskToMarkdown(task), "utf-8");

    if (
      this.config.autoArchive &&
      this.config.archiveStatuses.includes(newStatus)
    ) {
      this.archiveTask(task);
    }

    return task;
  }

  update(
    identifier: string,
    fields: { status?: string; priority?: string }
  ): Task {
    const task = this.find(identifier);

    if (fields.status !== undefined) {
      if (!this.config.statuses.includes(fields.status)) {
        throw new Error(
          `Invalid status: ${fields.status}. Use: ${this.config.statuses.join(", ")}`
        );
      }
      task.status = fields.status;
    }

    if (fields.priority !== undefined) {
      if (!this.config.priorities.includes(fields.priority)) {
        throw new Error(
          `Invalid priority: ${fields.priority}. Use: ${this.config.priorities.join(", ")}`
        );
      }
      task.priority = fields.priority;
    }

    writeFileSync(task.filePath, taskToMarkdown(task), "utf-8");

    if (
      this.config.autoArchive &&
      fields.status !== undefined &&
      this.config.archiveStatuses.includes(fields.status)
    ) {
      this.archiveTask(task);
    }

    return task;
  }

  search(keyword: string, includeArchived = false): Task[] {
    const tasks = this.loadAll(includeArchived);
    const query = keyword.toLowerCase();

    return tasks.filter((t) => {
      return (
        t.title.toLowerCase().includes(query) ||
        t.body.toLowerCase().includes(query)
      );
    });
  }

  stale(days = 14): Array<{ task: Task; ageDays: number }> {
    const tasks = this.loadAll();
    const today = new Date();
    const results: Array<{ task: Task; ageDays: number }> = [];

    const openTasks = tasks.filter((t) => t.status === "open");

    for (const task of openTasks) {
      if (!task.created) continue;
      const created = new Date(task.created);
      const age = Math.floor(
        (today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (age < days) continue;

      // Check git for recent activity mentioning this task
      const words = task.title.match(/[a-zA-Z]{3,}/g) ?? [];
      let hasActivity = false;

      for (const word of words) {
        try {
          const result = execFileSync(
            "git",
            ["log", `--since=${task.created}`, "--all", "--oneline", `--grep=${word}`, "-i"],
            {
              cwd: this.config.vaultRoot,
              encoding: "utf-8",
              timeout: 10000,
              stdio: ["pipe", "pipe", "pipe"],
            }
          );
          if (result.trim()) {
            hasActivity = true;
            break;
          }
        } catch {
          break;
        }
      }

      if (!hasActivity) {
        results.push({ task, ageDays: age });
      }
    }

    results.sort((a, b) => b.ageDays - a.ageDays);
    return results;
  }

  archiveCompleted(): Task[] {
    const tasks = this.loadAll();
    const toArchive = tasks.filter((t) =>
      this.config.archiveStatuses.includes(t.status)
    );

    if (toArchive.length === 0) return [];
    this.ensureArchiveDir();

    for (const task of toArchive) {
      this.archiveTask(task);
    }

    return toArchive;
  }

  allTags(): Map<string, number> {
    const tasks = this.loadAll();
    const counts = new Map<string, number>();

    for (const task of tasks) {
      for (const tag of task.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    return counts;
  }

  private archiveTask(task: Task): void {
    this.ensureArchiveDir();
    const name = basename(task.filePath);
    const dest = join(this.config.archiveDir, name);
    renameSync(task.filePath, dest);
    task.filePath = dest;
  }

  /** Relative path from vault root, for display. */
  relativePath(filePath: string): string {
    return relative(this.config.vaultRoot, filePath);
  }
}
