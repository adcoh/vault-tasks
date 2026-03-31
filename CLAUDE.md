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
  - `config.ts` — `.vault-tasks.toml` discovery and parsing
  - `store.ts` — `TaskStore` class: all task CRUD operations
  - `frontmatter.ts` — YAML frontmatter parser/writer
  - `counter.ts` — ID allocation (sequential, timestamp, ulid)
  - `slugify.ts` — title-to-kebab-case
  - `output.ts` — table formatting
  - `commands/` — one file per CLI command
- `templates/` — Claude Code skills, rules, and Obsidian Base dashboard
- `tests/` — node:test based tests

## Conventions

- Zero runtime dependencies. Only stdlib.
- All task data lives in markdown files with YAML frontmatter.
- Config is `.vault-tasks.toml` discovered by walking up from CWD.
