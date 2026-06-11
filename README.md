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

### Python projects (pip / uv)

If your project's lockfile is Python-based and you'd rather pin vault-tasks alongside your other dev dependencies:

```bash
pip install vault-tasks
# or
uv add --dev vault-tasks
```

The pip wheel is small (~100 KB) and bundles the same compiled JS that ships on npm. It still requires `node` (>= 20) on `PATH` — the wheel does not vendor a Node.js runtime.

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
| `vt search <keyword>` | Search titles and body text. `--all` includes archived. `--mode keyword\|bm25\|semantic\|hybrid`; `--like <id>` finds similar tasks; `--limit N` caps results. See [Semantic search](#semantic-search) |
| `vt show <id>` | Print full task file |
| `vt start <id>` | Set status to `in-progress` |
| `vt done <id>` | Set status to `done` (auto-archives) |
| `vt edit <id>` | Update fields: `--status`, `--priority`, `--tags` |
| `vt stale` | List open tasks older than 14 days. `--days` to customize |
| `vt archive` | Move all completed tasks to the archive directory |
| `vt tags` | List all tags and their counts |
| `vt lint` | Audit the vault: broken wikilinks, orphan evergreens, stale refs, drift. `--only`, `--scope`, `--json`, `--quiet`, `--no-suggestions` |
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
| `/lint` | Vault health check: broken wikilinks, orphans, stale refs, convention drift |

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
- `lintVault` -- run all lint checks; returns a `LintReport`
- Lower-level lint primitives: `buildIndex`, `resolveTarget`,
  `collectWikilinks`, `findBrokenLinks`, `findOrphanEvergreens`,
  `findStaleReferences`, `findEvergreenDrift`, `attachSuggestions`
- Types: `Task`, `CreateTaskOpts`, `Config`, `LintReport`, `LintOptions`,
  `WikiLink`, `VaultFile`, `BrokenEntry`, `Suggestion`, `SearchHit`,
  `SearchMode`, `SearchOptions`

### Ranked search (`vault-tasks/search`)

A separate, zero-dependency subpath export provides BM25-ranked search and
task-to-task similarity. Imported only when needed -- the core `vault-tasks`
entry point is unaffected.

```typescript
import { TaskStore, loadConfig } from "vault-tasks";
import { searchTasks, similarTasks, BM25Index, VectorIndex, tokenize } from "vault-tasks/search";

const store = new TaskStore(loadConfig());

// Free-text query, ranked by BM25
const hits = await searchTasks(store, "auth callback", { mode: "bm25", limit: 10 });

// Vector similarity (uses the configured embedding engine)
const semantic = await searchTasks(store, "login flow", { mode: "semantic" });

// Tasks similar to a given task
const target = store.findIncludingArchive("0042");
const related = await similarTasks(store, target, { mode: "hybrid" });
```

Available modes:

| Mode | Ranking | Needs an engine? |
|---|---|---|
| `keyword` (default) | substring match across title, body, AND tags; priority-sorted | no |
| `bm25` | BM25 relevance, title-weighted | no |
| `semantic` | cosine similarity over embeddings | yes |
| `hybrid` | `bm25` + `semantic` fused with Reciprocal Rank Fusion | yes |

## Semantic search

`semantic` and `hybrid` modes rank tasks by meaning rather than shared words.
They need an **embedding engine** to turn text into vectors; `keyword` and
`bm25` never do and stay fully offline.

**Local-first by default — no data leaves your machine, no API key.**
vault-tasks talks to a local [Ollama](https://ollama.com) server:

```bash
ollama serve                      # start the local server
ollama pull nomic-embed-text      # pull the default model (768 dims)
vt search "auth redirect" --mode semantic
vt search --like 0042 --mode hybrid
```

Vectors are cached at `<vault>/.vault-tasks/embeddings.json`, so only new or
changed tasks are re-embedded on later runs. (Add that path to `.gitignore` if
you don't want to commit it.)

Configure the engine under `[search]` in `.vault-tasks.toml`:

```toml
[search]
embedding_provider = "ollama"          # ollama | lmstudio | llamacpp | openai-compatible
                                       # | transformers | openai | voyage | gemini
embedding_model = "nomic-embed-text"   # also: mxbai-embed-large (1024d), all-minilm (384d)
# embedding_endpoint = ""              # override server URL; empty = provider default
```

- **Other local servers**: set `embedding_provider` to `lmstudio` or `llamacpp`
  (OpenAI-compatible `/v1/embeddings`); the default endpoints are
  `http://localhost:1234` and `http://localhost:8080`.
- **In-process, no server**: install the optional package and switch provider —
  `npm i @huggingface/transformers`, then `embedding_provider = "transformers"`
  with `embedding_model` set to a Hugging Face repo id. It's an
  `optionalDependency`, so the core install stays dependency-free.
- **Cloud (opt-in)**: `embedding_provider = "openai"` (or `voyage`/`gemini`).
  The API **key** is read from an environment variable you name via
  `embedding_api_key_env` — it is never stored in config or on disk.

## License

MIT
