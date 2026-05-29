# Changelog

All notable changes to this project will be documented here.

## 0.5.0

### Added

- **Optional BM25 ranked search.** New `vault-tasks/search` subpath export
  ships a zero-dependency, in-memory BM25 index alongside a Unicode-aware
  tokenizer (`tokenize`, `BM25Index`, `searchTasks`, `similarTasks`). The
  main `vault-tasks` import is unchanged — the BM25 code is parse-cost-free
  unless you reach for it.
- **`vt search --mode bm25`.** Ranks results by BM25 score across title
  (weighted), tags, and body. Falls back to legacy substring matching when
  `--mode` is omitted, so the default behavior is byte-identical to 0.4.x.
- **`vt search --like <id>`.** Finds tasks similar to a given task (works
  on archived tasks via the new read-only `TaskStore.findIncludingArchive`).
  Requires `--mode bm25`.
- **`vt search --limit N`.** Caps the result set across both keyword and
  bm25 modes. In keyword mode the cap is applied *after* the priority sort,
  so the highest-priority matches are always preserved.
- **`store.search()` now matches tags** as well as title and body, so the
  CLI's keyword scope agrees with the BM25 mode's scope. ([#15](https://github.com/adcoh/vault-tasks/pull/15))

### Fixed

- **Prototype-chain crash on hand-edited statuses.** A task with
  `status: constructor` (or `toString`, `__proto__`, `hasOwnProperty`)
  previously crashed every `vt list` / `vt search` with a `TypeError`
  because the `STATUS_DISPLAY` lookup fell through to an inherited
  prototype function. The lookup now uses `Object.hasOwn` and the fallback
  routes through display sanitization.
- **ANSI / control-character / newline injection via task fields.** A
  malicious title (e.g. `\x1b[31mPWNED\x1b[0m` or `real\n0099 ... FORGED`)
  used to recolor terminals or forge fake table rows. All task-field
  interpolations in `formatTaskTable`, `formatStaleTable`,
  `formatSearchHits`, and CLI error messages now strip C0/C1 control bytes
  and collapse `\r\n\t` to spaces.
- **Strict numeric validation for `--limit` and `--days`.** `parseInt`
  silently accepted trailing garbage (`5abc` → 5), fractional values
  (`2.5` → 2), and overflow (`99999999999999999999`). The new
  `parsePositiveIntFlag` requires a bare positive `Number.isSafeInteger`.
  The library `resolveLimit` is aligned via the same predicate.
- **`main().catch` no longer prints literal `undefined`.** Non-Error
  rejections (`throw 'string'`, `Promise.reject()`, plain-object throws)
  now surface a coerced diagnostic via a typed `errorMessage(err)` helper.
- **Unbounded memory on hostile task bodies.** A multi-megabyte task body
  could OOM every `vt search` invocation because the BM25 index was
  rebuilt per call with no document-size cap. The constructor now caps
  each document at 2 MB of source text and 100 k tokens. A 3 MB body
  indexes cleanly under a 512 MB Node heap.
- **Keyword-mode `--limit` no longer drops high-priority matches.** The
  CLI used to slice in filename order before sorting by priority, silently
  excluding higher-priority matches in later files. Sort-then-slice is
  now the order in both the CLI command and the library API.
- **Library / CLI default-mode alignment.** Both surfaces default to
  `keyword` mode; the library keyword path now priority-sorts and
  matches tags, mirroring the CLI exactly.
- **`SearchMode` type narrowed to `'keyword' | 'bm25'`.** The earlier
  `'semantic' | 'hybrid'` members were not implemented and threw at
  runtime; they now fail at compile time. An `assertExhaustive(x: never)`
  guards future mode additions.
- **Silent `--like` + positional discard.** `vt search auth --like 0042
  --mode bm25` previously dropped `auth` without warning. The combination
  is now rejected with an actionable error; empty `--like` values are
  also rejected up front.
- **Dead BM25 guards removed.** The unreachable `if (idf <= 0)` and
  `if (score > 0)` branches (the smoothed IDF is strictly positive) used
  to mask the contract; they would have silently dropped valid contributions
  if a future maintainer reverted to an unsmoothed formula.

## 0.4.0

### Added

- **pip / uv installation.** `vault-tasks` is now distributed as a Python
  wheel (`py3-none-any`, ~125 KB) alongside the existing npm package, so it
  can be pinned in `pyproject.toml` / `uv.lock` as a dev dependency. The
  wheel bundles the same compiled JS and templates as the npm build; a
  Python entry point locates `node` on PATH and execs the CLI. Errors
  with exit 127 and an actionable message if Node.js isn't installed.
  ([#8](https://github.com/adcoh/vault-tasks/pull/8))
- **`vt new` body content from CLI.** Three new input shapes for supplying
  a real markdown body at creation time instead of the auto-generated
  `# {title}` placeholder: `--body "text"` for inline strings,
  `--body-file <path>` to read from disk, and `--body -` to read from stdin.

### Fixed

- **Argument parsing crash on missing flag values.** `vt new T --priority`
  (and similar value-bearing flags supplied without a value) used to crash
  because the boolean fallback was passed into `.toLowerCase()`. Now
  errors cleanly with a helpful message.
- **Folded-scalar frontmatter values are no longer silently truncated.**
  A YAML plain-style scalar that wrapped across an indented continuation
  line (e.g. `title:` followed by `  recording session`) used to lose
  everything after the first line on parse — and any subsequent `vt edit`
  / `vt done` / `vt start` etc. would write the truncated value back to
  disk. Continuation lines are now joined onto the parent key with a
  single space, matching YAML's standard folding rule. ([#9](https://github.com/adcoh/vault-tasks/issues/9))
- **Extra frontmatter fields no longer drift to the top of the block on
  write.** Custom keys outside the known-keys set (e.g. `oncall_fix_kind`,
  bespoke Obsidian properties) are now emitted *after* the standard
  fields, eliminating diff noise on every save.
- **Zero-indent block-list items are no longer silently dropped.** Tag
  lists written at column 0 (`tags:\n- audio\n- voice-control`, the style
  Obsidian and the reproducer in #9 both use) used to fall through every
  regex branch in the parser and disappear, leaving `tags` as an empty
  array. A subsequent `vt done` / `vt edit --priority …` would then
  serialize the empty array back to disk, deleting the user's tags.
- **Hyphen-prefixed scalar continuations are no longer misparsed as
  list items.** A folded scalar whose continuation line starts with `-`
  (e.g. `title: Foo\n  - bar`) used to flip the string into a single-item
  array `["bar"]`, dropping the first line. The list-item branch is now
  guarded so it only fires when the current key is expecting a list.

## 0.3.0

### Added

- **`vt lint`** — read-only audit of an Obsidian-style vault. Detects
  broken wikilinks (with frequency aggregation and "did you mean?"
  suggestions), orphan evergreens, stale references, and convention drift
  on evergreens. Completes the Maintain pillar of the LLM-Wiki pattern
  alongside `vt new` (Compile) and `vt stale`/`vt archive`.

  Resolution is Obsidian-correct: case-insensitive,
  whitespace/hyphen/underscore/colon-agnostic, resolves against filename
  stem, full path, `title:` frontmatter, and `aliases:`. Path-form
  (`[[10-areas/foo/CONTEXT]]`) and partial-tail (`[[parenting/CONTEXT]]`)
  targets work. `|alias` and `#anchor` suffixes are stripped before
  resolution.

  CLI flags: `--only <check>`, `--scope <dir>`, `--json`, `--quiet`,
  `--no-suggestions`. Exit codes: `0` clean, `1` issues, `2` config/I-O
  error.

  Per-file opt-outs via flat frontmatter keys: `lint_orphan_ok`,
  `lint_stale_ok`, `lint_drift_ok`.

  Configurable in `.vault-tasks.toml` under `[lint]` and
  `[lint.evergreen_conventions]`.

- **`/lint` skill template** installed by `vt install-skills --install`.
  Wraps the CLI for a Claude Code conversation: presents findings,
  suggests next actions, never auto-edits.

- Library API: `lintVault`, `buildIndex`, `resolveTarget`,
  `collectWikilinks`, `findBrokenLinks`, `findOrphanEvergreens`,
  `findStaleReferences`, `findEvergreenDrift`, `attachSuggestions`,
  `computeLeverageFixes`, plus the `LintReport` / `LintOptions` /
  `WikiLink` / `VaultFile` types.

## 0.2.0

### Breaking — library API

- **`Task.id` type changed from `number` → `string`.** All ID strategies now
  return strings (sequential, timestamp, ULID). Library consumers iterating
  task IDs must drop arithmetic on `task.id` (`task.id + 1`,
  `Math.max(...tasks.map(t => t.id))` no longer behaves as expected).
  Use `parseInt(task.id, 10)` if you need numeric comparison on a sequential
  vault.

### Breaking — defaults (CLI)

- **Default ID strategy is now `ulid`** for new vaults. ULIDs are
  collision-proof, lexicographically sortable, and require no counter file.
- **Existing 0.1.x vaults are auto-detected as sequential** and will keep
  producing `NNNN-*.md` filenames. The detection runs whether or not a
  `.vault-tasks.toml` is present:
  - No config file + existing `NNNN-*.md` files → sequential (with inferred
    pad width).
  - Config file with no explicit `[id] strategy` + existing `NNNN-*.md` files
    → sequential (with inferred pad width).
  - Empty vault → ULID.
- **No data migration is performed.** Existing files are never renamed.
- **Switching strategies is non-destructive.** Setting `[id] strategy = "ulid"`
  in an existing sequential vault will keep all existing `NNNN-*` files
  readable, findable, and listable. New tasks will get ULID filenames; the
  vault becomes a mix. Lookup (`vt done 12`, `vt done 01HYX…`) handles both
  formats. The orphaned `.vault-tasks-counter.json` can be deleted by hand.

### Added

- Fuzzy duplicate detection on `vt new` via trigram Dice similarity.
  Configurable via `[task] dedupe_threshold` (0..1, default 0.5) and
  `[task] dedupe_scan_limit` (most-recent N tasks scanned, default 500).
  Suppress with `--no-dedupe`.
- ULID prefix lookup: `vt done 01HYX` matches by ID prefix (≥ 4 chars).
- `[id] strategy` is validated against the enum at config load time; typos
  produce an actionable error naming the config file path.
- Public exports: `generateUlid`, `isValidUlid`, `decodeTime`,
  `parseTaskIdFromFilename`.

### Fixed

- Boolean CLI flags now correctly handle `--flag=value` form
  (`--no-dedupe=true`, `--commit=false`). Previously the value was stored as
  a string and the boolean check silently fell through.
- `vt done 01` (or any short purely-digit identifier) on a ULID-only vault
  now reports "No task matching" instead of silently editing an arbitrary
  ULID task whose ID happens to start with `01`.
- Strict task-file recognition: files like `notes-about-x.md` or `README.md`
  in the backlog directory are no longer treated as tasks. ULIDs containing
  Crockford ambiguity characters (I/L/O) are rejected.
- Atomic `.gitignore` creation in `vt init` (no TOCTOU; never overwrites an
  existing `.gitignore`).
- Diacritic folding in similarity normalization. `"café résumé"` and
  `"cafe resume"` now compare as identical.
- ULID monotonic overflow no longer throws; bumps to next millisecond and
  reseeds. Clock rewind (NTP step-back) no longer regresses the ID stream.
- Ambiguous ID-match errors include next-step guidance (use more characters
  or full filename).

## 0.1.0

Initial release.
