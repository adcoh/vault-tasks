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

// Strict ID prefix for a task filename. Matches:
//   - Canonical ULID (26-char Crockford base32, no I/L/O/U)
//   - Numeric prefix (sequential or 14-digit timestamp)
// The `.md` suffix check is the caller's responsibility.
//
// Keeping this strict means non-task files (README.md, notes-about-x.md, etc.)
// sitting in the backlog or archive directory don't silently get picked up by
// listing, searching, ID lookup, or dedupe.
const TASK_ID_RE = /^(\d+|[0-9A-HJKMNP-TV-Z]{26})-[^/]*\.md$/i;

/** Return the ID prefix of a task filename, or null if it doesn't look like a task. */
export function parseTaskIdFromFilename(name: string): string | null {
  const m = name.match(TASK_ID_RE);
  return m ? m[1] : null;
}

/** True if an identifier is a plausible ULID prefix (canonical Crockford, >= 4 chars). */
function looksLikeUlidPrefix(s: string): boolean {
  return s.length >= 4 && /^[0-9A-HJKMNP-TV-Z]+$/i.test(s) && !/^\d+$/.test(s);
}

function fileToTask(filePath: string, text: string): Task {
  const { meta, body } = parseFrontmatter(text);
  const name = basename(filePath);
  const stem = name.replace(/\.md$/, "");
  const id = parseTaskIdFromFilename(name);

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
    id: id ?? "",
    title: String(meta["title"] ?? "") || stem,
    status: String(meta["status"] ?? "") || "open",
    priority: String(meta["priority"] ?? "") || "medium",
    tags,
    created: String(meta["created"] ?? "") || "",
    source: String(meta["source"] ?? "") || "",
    body,
    filePath,
    slug: stem,
    extraMeta,
  };
}

function taskToMarkdown(task: Task): string {
  const meta: Record<string, unknown> = {
    ...task.extraMeta,
    title: task.title,
    status: task.status,
    priority: task.priority,
    tags: task.tags,
    created: task.created,
    source: task.source,
  };
  return writeFrontmatter(meta, task.body);
}

export class TaskStore {
  constructor(public readonly config: Config) {}

  private ensureBacklogDir(): void {
    mkdirSync(this.config.backlogDir, { recursive: true });
  }

  private ensureArchiveDir(): void {
    mkdirSync(this.config.archiveDir, { recursive: true });
  }

  private listMdFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => parseTaskIdFromFilename(f) !== null)
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
        id: idStr,
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

  /**
   * Load at most `limit` tasks, preferring the most recent. Filenames are
   * time-sortable (ULID timestamp prefix or monotonic sequential ID), so
   * alphabetic sort approximates chronological order.
   *
   * Used to bound O(N) dedupe scans on mature vaults. Pass `limit = 0` to
   * disable the cap (equivalent to `loadAll(includeArchived)`).
   */
  loadRecent(limit: number, includeArchived = false): Task[] {
    this.ensureBacklogDir();
    const paths: string[] = [...this.listMdFiles(this.config.backlogDir)];
    if (includeArchived) {
      paths.push(...this.listMdFiles(this.config.archiveDir));
    }
    paths.sort();
    const slice = limit > 0 ? paths.slice(-limit) : paths;
    return slice.map((f) => fileToTask(f, readFileSync(f, "utf-8")));
  }

  private matchInDir(identifier: string, dir: string): Task | null {
    const files = this.listMdFiles(dir);

    const ambiguous = (matches: string[]): Error => {
      const names = matches.map((m) => basename(m));
      return new Error(
        `Ambiguous match for '${identifier}' — ${matches.length} candidates:\n` +
        `${names.map((n) => `  ${n}`).join("\n")}\n` +
        `Use more characters of the ID, or the full filename stem.`
      );
    };

    // 1. Purely-digit identifiers take the numeric branch exclusively. This
    //    prevents a short string like "01" (parseInt = 1, not a valid numeric
    //    match) from silently falling through to the ULID-prefix branch and
    //    returning an arbitrary ULID task whose ID happens to start with "01"
    //    (which is true for virtually every ULID from 2016–2039).
    if (/^\d+$/.test(identifier)) {
      const numId = parseInt(identifier, 10);
      if (Number.isSafeInteger(numId)) {
        // Accept the identifier as typed (e.g. "0001-*") and also zero-padded
        // to padWidth (so "1" finds "0001-*" with padWidth=4).
        const candidatePrefixes = new Set<string>([
          `${identifier}-`,
          `${String(numId).padStart(this.config.padWidth, "0")}-`,
        ]);
        const numericMatches = files.filter((f) => {
          const name = basename(f);
          for (const p of candidatePrefixes) {
            if (name.startsWith(p)) return true;
          }
          return false;
        });
        if (numericMatches.length === 1) {
          return fileToTask(numericMatches[0], readFileSync(numericMatches[0], "utf-8"));
        }
        if (numericMatches.length > 1) {
          throw ambiguous(numericMatches);
        }
      }
      // Deliberately do NOT fall through to the ULID-prefix branch: a digit-only
      // identifier is unambiguously a numeric ID request, and silently matching
      // a ULID that happens to share the same digit prefix would be a data bug.
      return null;
    }

    // 2. ULID prefix match (case-insensitive). Requires at least 4 characters
    //    of canonical Crockford base32 to avoid trivial collisions.
    if (looksLikeUlidPrefix(identifier)) {
      const upperIdent = identifier.toUpperCase();
      const prefixMatches = files.filter((f) => {
        const fileId = parseTaskIdFromFilename(basename(f));
        return fileId !== null && fileId.toUpperCase().startsWith(upperIdent);
      });
      if (prefixMatches.length === 1) {
        return fileToTask(prefixMatches[0], readFileSync(prefixMatches[0], "utf-8"));
      }
      if (prefixMatches.length > 1) {
        throw ambiguous(prefixMatches);
      }
    }

    // 3. Substring match on filename stem.
    const query = identifier.toLowerCase();
    const matches = files.filter((f) => {
      const name = basename(f).replace(/\.md$/, "");
      return name.toLowerCase().includes(query);
    });

    if (matches.length === 1) {
      return fileToTask(matches[0], readFileSync(matches[0], "utf-8"));
    }
    if (matches.length > 1) {
      throw ambiguous(matches);
    }

    return null;
  }

  find(identifier: string): Task {
    this.ensureBacklogDir();

    // Search backlog first
    const backlogMatch = this.matchInDir(identifier, this.config.backlogDir);
    if (backlogMatch) {
      return backlogMatch;
    }

    // Fallback: search archive
    const archiveMatch = this.matchInDir(identifier, this.config.archiveDir);
    if (archiveMatch) {
      throw new Error(
        `Task '${identifier}' is archived (in archive/). To modify it, move it back to backlog first.`
      );
    }

    throw new Error(`No task matching '${identifier}'`);
  }

  setStatus(identifier: string, newStatus: string): Task {
    return this.update(identifier, { status: newStatus });
  }

  update(
    identifier: string,
    fields: { status?: string; priority?: string; tags?: string[] }
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

    if (fields.tags !== undefined) {
      task.tags = fields.tags;
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

    const openTasks = tasks.filter((t) => t.status === "open");

    // Find the earliest created date among candidates to scope a single git log
    const candidates: Array<{ task: Task; ageDays: number }> = [];
    let earliestDate = "";

    for (const task of openTasks) {
      if (!task.created || !/^\d{4}-\d{2}-\d{2}/.test(task.created)) continue;
      const created = new Date(task.created);
      const age = Math.floor(
        (today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (age < days) continue;
      candidates.push({ task, ageDays: age });
      if (!earliestDate || task.created < earliestDate) {
        earliestDate = task.created;
      }
    }

    if (candidates.length === 0) return [];

    // Fetch git log once, search in-process instead of spawning per-word
    let gitLog = "";
    try {
      gitLog = execFileSync(
        "git",
        ["log", `--since=${earliestDate}`, "--all", "--name-only", "--oneline"],
        {
          cwd: this.config.vaultRoot,
          encoding: "utf-8",
          timeout: 15000,
          stdio: ["pipe", "pipe", "pipe"],
        }
      ).toLowerCase();
    } catch {
      // git not available — treat all candidates as stale
      candidates.sort((a, b) => b.ageDays - a.ageDays);
      return candidates;
    }

    const results: Array<{ task: Task; ageDays: number }> = [];

    for (const { task, ageDays } of candidates) {
      const slug = basename(task.filePath).replace(/\.md$/, "").toLowerCase();
      const hasActivity = gitLog.includes(slug);
      if (!hasActivity) {
        results.push({ task, ageDays });
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
    if (existsSync(dest)) {
      throw new Error(`Archive destination already exists: ${name}. Resolve the conflict manually.`);
    }
    renameSync(task.filePath, dest);
    task.filePath = dest;
  }

  /** Relative path from vault root, for display. */
  relativePath(filePath: string): string {
    return relative(this.config.vaultRoot, filePath);
  }
}
