# vault-tasks

Zero-dependency CLI + library for managing tasks as markdown files. Built for solo devs working with Claude Code.

## Development

```bash
npm install          # install dev deps (typescript, @types/node)
npx tsc              # build
node --test dist/tests/*.test.js   # run tests
node dist/cli.js <command>         # run locally
```

## Architecture

- `src/` — TypeScript source
  - `cli.ts` — entry point, argument parsing
  - `task.ts` — `Task` and `CreateTaskOpts` type definitions
  - `config.ts` — `.vault-tasks.toml` discovery and parsing
  - `store.ts` — `TaskStore` class: all task CRUD operations
  - `frontmatter.ts` — YAML frontmatter parser/writer
  - `counter.ts` — ID allocation (sequential, timestamp, ulid)
  - `slugify.ts` — title-to-kebab-case
  - `output.ts` — table formatting
  - `index.ts` — public library API exports
  - `commands/` — one file per CLI command
- `templates/` — Claude Code skills, rules, and Obsidian Base dashboard
- `tests/` — node:test based tests

## Conventions

- Zero runtime dependencies. Only stdlib.
- All task data lives in markdown files with YAML frontmatter.
- Config is `.vault-tasks.toml` discovered by walking up from CWD.

## Code Review Standard

You are the sole maintainer of a public npm package. Every line you write or approve will run on strangers' machines, in their vaults, with their data. Act like it. Review your own output with the same hostility you'd bring to a PR from someone you don't trust.

### Security — Zero Trust for All Inputs

- **Every string that touches the filesystem, a shell, YAML output, or git args is hostile until proven safe.** This includes: task titles, frontmatter values, config file contents, CLI arguments, filenames read from disk. "The user controls it" is not a defense — users make mistakes, and configs can be hand-edited.
- **Path traversal**: Any path derived from config or user input MUST be validated to stay inside the vault root. Use `relative()` and check for leading `..`. Never trust `resolve()` alone.
- **YAML injection**: `writeFrontmatter` MUST quote values containing YAML-special characters (`:`, `#`, `[`, `]`, `{`, `}`, `"`, `'`, `!`, `&`, `*`, `|`, `>`). Round-trip safety is non-negotiable — `parse(write(data))` must return the same data. If it doesn't, the code is broken.
- **Shell/command injection**: Never use `exec` or `execSync`. Always `execFileSync` with array args. Validate any value interpolated into git arguments (e.g., `--since` dates must match `/^\d{4}-\d{2}-\d{2}/`).
- **No unbounded filesystem walks**: Never walk up to `/` looking for a directory. Bound all searches to a known depth or anchor to `package.json`.
- **File conflicts**: Before `renameSync`, check if the destination exists. Before `writeFileSync` for new files, use `openSync` with `wx` flag. Silent overwrites are data loss bugs.

### Correctness — Silent Failures are Bugs

- **No `as` casts on user data.** If a YAML field might not be a string, use `String(value ?? "") || fallback`. Unsafe casts compile but crash at runtime.
- **No TOCTOU patterns.** `existsSync` + `mkdirSync` is a race. Just call `mkdirSync({ recursive: true })` unconditionally. Same for any check-then-act on the filesystem.
- **CRLF**: Both parsers (frontmatter and TOML) MUST normalize `\r\n` to `\n` before processing. Windows users exist. `"open\r" !== "open"` is a real bug that fails silently.
- **Numeric IDs must be safe integers.** Any ID parsed from a filename or generated from timestamps must pass `Number.isSafeInteger()`. Precision loss means two different files mapping to the same ID.
- **Every `parseInt` must be validated.** If `parseInt(userInput)` returns `NaN`, the code must error — not silently propagate NaN through arithmetic that produces wrong results.
- **Empty arrays are not nullish.** `[] ?? default` returns `[]`, not `default`. `[] || default` also returns `[]`. If an empty array is a problem, check `.length` explicitly.
- **`loadConfig` must return fully-resolved absolute paths.** Both the config-found and no-config-found code paths. Relative `backlogDir` is a time bomb — it resolves against CWD at call time, not vault root.

### API & UX — Predictable, Honest, Helpful

- **Errors must be actionable.** "No task matching '42'" is bad when the task exists in the archive. Say "Task '42' is archived. Move it back to backlog to modify it." Every error should tell the user what to do next.
- **Commands must be consistent.** If `--status` and `--priority` are case-insensitive in one command, they must be in all commands. If `--all` means "include archived" in `list`, it cannot mean "install everything" in `install-skills` without confusion.
- **Filtering must search the right scope.** `list --status done` must include the archive — that's where done tasks live. Don't make users memorize which flags implicitly expand the search scope.
- **No dead code in output.** If `setStatus("done")` always sets status to "done", don't write `task.status === "done" ? "done" : task.status`. The else branch is unreachable. Unreachable code in user-facing output means nobody is testing it.
- **Detect no-ops.** `start` on a task that's already in-progress should say so, not silently rewrite the file with the same content.
- **Arg parsing must handle standard conventions.** `--key=value`, `--` as end-of-flags, `-h` for help, negative numbers as values not flags. Users don't read your help text — they assume POSIX.

### Testing — If It's Not Tested, It's Broken

- **Every public method needs tests.** Not "most." Every. Including error paths. Including edge cases.
- **Every parser needs adversarial input tests.** Colons in values, `---` in values, CRLF, empty input, missing delimiters, duplicate keys, values that look like YAML types (`true`, `null`, `42`). If a user can type it, test it.
- **Security properties need explicit assertions.** Path traversal characters in slugs, `Number.isSafeInteger` for IDs, quoted output for special chars. These are not "nice to have" — they are the contract.
- **Round-trip tests are mandatory for serialization.** `parse(write(data)) === data` for all frontmatter types: strings, arrays, empty arrays, quoted strings, wikilinks, special characters.
- **Test the zero-state.** Empty vault, no tasks, no config file, no git repo. These are the first thing new users hit.
- **Assertions must be specific.** `assert.ok(lines.length >= 4)` passes with garbage output. Use exact equality or content checks. Weak assertions are false confidence.
- **Test coverage baseline: every file has a corresponding test file.** `counter.ts` → `counter.test.ts`. `output.ts` → `output.test.ts`. No exceptions.
- **Tests must run against a build.** `npm test` runs `dist/` artifacts. If you change source and tests pass without rebuilding, your CI is lying.

### Process — What Gets Checked

Before marking any task complete or any PR ready:

1. `npx tsc --noEmit` — zero errors. No `skipLibCheck` shortcuts.
2. `npm test` — zero failures. Not "the important ones pass."
3. Check every `writeFileSync` / `renameSync` for overwrite safety.
4. Check every `parseInt` / `parseFloat` for NaN propagation.
5. Check every user-facing string for injection or corruption potential.
6. Check every error message: does it tell the user what happened AND what to do?
7. Check every new CLI flag: is it consistent with existing flags across all commands?
