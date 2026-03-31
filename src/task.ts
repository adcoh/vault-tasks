/**
 * Task type — the core data model.
 *
 * Each task is a markdown file with YAML frontmatter.
 * `extraMeta` preserves any user-added frontmatter fields
 * that vault-tasks doesn't manage (e.g. `due`, `assignee`).
 */
export interface Task {
  id: number;
  title: string;
  status: string;
  priority: string;
  tags: string[];
  created: string; // ISO date YYYY-MM-DD
  source: string;
  body: string;
  filePath: string;
  slug: string;
  extraMeta: Record<string, unknown>;
}

export interface CreateTaskOpts {
  title: string;
  priority?: string;
  tags?: string[];
  source?: string;
  body?: string;
}
