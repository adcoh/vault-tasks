---
globs: 50-backlog/**
---

# Backlog Rules

- One task per file in `50-backlog/`, named `NNNN-kebab-case-title.md`
- Required frontmatter: `title`, `status`, `priority`, `tags`, `created`, `source`
- Status values: `open`, `in-progress`, `done`, `wont-do`
- Priority values: `high`, `medium`, `low`
- `source` field links back to where the task was noticed (journal entry, build log, conversation)
- Body is free-form — at minimum a one-liner and relevant `[[wikilinks]]`
- Done/wont-do tasks are moved to `50-backlog/archive/` — keeps active task search fast. Never delete task files.
- Use the CLI for quick operations: `vt new "Title" --priority high --tags tag1,tag2`
