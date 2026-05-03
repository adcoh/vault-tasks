# Changelog

All notable changes to this project will be documented here.

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
