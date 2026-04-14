# vault-tasks

Markdown-file task manager for solo devs building with [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Tasks are plain markdown files with YAML frontmatter. They live in your repo (or Obsidian vault), are version-controlled with git, and are readable by humans and LLMs alike. Zero runtime dependencies.

## Install

```bash
npm install -g vault-tasks
```

Or use without installing:

```bash
npx vault-tasks <command>
```

Requires Node.js >= 20.

## Quick start

```bash
# Initialize in your repo/vault root
vt init

# Create a task
vt new "Fix login redirect bug" --priority high --tags auth,bug

# See what's open
vt list

# Start working on it
vt start 1

# Mark it done (auto-archives by default)
vt done 1
```

`vt init` creates a `.vault-tasks.toml` config and a `backlog/` directory. Tasks are markdown files with ULID prefixes (e.g., `01HYX3KQPD7NG8RRGSSFQ9XNHY-fix-login-redirect-bug.md`). Sequential numeric IDs (`0001-...`) are also supported via config.

## Commands

| Command | Description |
|---|---|
| `vt new <title>` | Create a task. Options: `--priority`, `--tags`, `--source`, `--commit` |
| `vt list` | List open tasks. Options: `--status`, `--priority`, `--tag`, `--all` |
| `vt search <keyword>` | Search titles and body text. `--all` includes archived |
| `vt show <id>` | Print full task file |
| `vt start <id>` | Set status to `in-progress` |
| `vt done <id>` | Set status to `done` (auto-archives) |
| `vt edit <id>` | Update fields: `--status`, `--priority`, `--tags` |
| `vt stale` | List open tasks older than 14 days. `--days` to customize |
| `vt archive` | Move all completed tasks to the archive directory |
| `vt tags` | List all tags and their counts |
| `vt init` | Initialize config and backlog directory |
| `vt install-skills` | Install Claude Code skills and rules. `--install`, `--list`, `--update` |

Task lookup (`<id>`) accepts a ULID prefix (e.g., `vt done 01HYX`), a numeric ID for sequential vaults (e.g., `vt done 1`), or a substring match against the filename (e.g., `vt done login`).

## Task format

Each task is a markdown file with YAML frontmatter:

```markdown
---
title: "Fix login redirect bug"
status: open
priority: high
tags:
  - auth
  - bug
created: 2026-04-02
source: "[[2026-04-02 Session Log]]"
---

# Fix login redirect bug

After OAuth callback, users are redirected to `/` instead of the page they came from.
```

- **Status**: `open`, `in-progress`, `done`, `wont-do`
- **Priority**: `high`, `medium`, `low`
- **Tags**: freeform, filterable via `vt list --tag`
- **Source**: where the task was noticed (supports `[[wikilinks]]`)

Extra frontmatter fields (e.g. `due`, `assignee`) are preserved through all operations.

## Configuration

`vt init` creates `.vault-tasks.toml` at your vault root:

```toml
[paths]
backlog_dir = "backlog"           # where task files live
archive_dir = "archive"           # relative to backlog_dir
# journal_dir = "journal"         # build logs and session notes
# projects_dir = "projects"       # project folders with CONTEXT.md
# evergreen_dir = "evergreen"     # evergreen/zettelkasten notes

[task]
# statuses = ["open", "in-progress", "done", "wont-do"]
# priorities = ["high", "medium", "low"]
# default_priority = "medium"
# default_status = "open"
# archive_statuses = ["done", "wont-do"]
# auto_archive = true

[id]
# strategy = "ulid"               # "ulid" | "sequential" | "timestamp"
# pad_width = 4                   # zero-pad width (only used with sequential)

[slugify]
# max_length = 60
```

The config file is discovered by walking up from the current directory, so it works from any subdirectory.

## Claude Code skills

vault-tasks ships with skill templates that teach Claude Code how to work with your task backlog:

```bash
vt install-skills --install
```

This installs into `.claude/skills/` and `.claude/rules/`:

| Skill | What it does |
|---|---|
| `/brief` | Pre-session briefing: open tasks, last session context, stale threads |
| `/build-log` | End-of-session log: what was built, learned, decided. Extracts tasks |
| `/weekly-review` | Consolidates journal entries, creates evergreen notes, triages backlog |
| `/task` | Quick task creation/management from within a session |

Skills reference configurable vault paths (`journal_dir`, `projects_dir`, `evergreen_dir`) which are substituted from your `.vault-tasks.toml` at install time. Customize any skill by creating a `SKILL.local.md` next to the installed `SKILL.md` -- local files are never overwritten.

An [Obsidian Bases](https://obsidian.md/blog/bases/) dashboard (`backlog.base`) is also installed for visual task management.

## Library API

vault-tasks also exports a programmatic API:

```typescript
import { loadConfig, TaskStore } from "vault-tasks";

const config = loadConfig();
const store = new TaskStore(config);

// Create
const task = store.create({ title: "My task", priority: "high", tags: ["api"] });

// Query
const all = store.loadAll();
const results = store.search("login");
const stale = store.stale(14);
const tags = store.allTags();

// Update
store.update(task, { status: "done", priority: "low", tags: ["api", "shipped"] });
store.archiveCompleted();
```

### Exports

- `TaskStore` -- all CRUD operations
- `loadConfig` / `findConfigFile` -- config discovery and parsing
- `parseFrontmatter` / `writeFrontmatter` -- YAML frontmatter utilities
- `slugify` -- title to kebab-case filename
- Types: `Task`, `CreateTaskOpts`, `Config`

## License

MIT
