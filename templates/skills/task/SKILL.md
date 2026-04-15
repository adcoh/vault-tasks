---
name: task
description: Create, list, or manage backlog tasks. Use when the user says "add a task", "log a task", "what's on the backlog", or when you notice something that needs fixing outside the current scope.
---

> If `SKILL.local.md` exists in this directory, read it first. Local instructions extend this behavior. Where they conflict, local wins.

# /task

## Steps

1. Determine intent: creating a new task, listing tasks, or updating a task
2. For new tasks:
   - Use the title provided, or ask for one if not given
   - Infer priority and tags from context (default: `--priority medium`)
   - Set `--source` to link back to the current journal entry or conversation context
   - Run: `vt new "Title" --priority <P> --tags <t1,t2> --source "[[YYYY-MM-DD]]"`
3. For listing: run `vt list` with appropriate filters and present results
4. For updates: run `vt done <id>`, `vt start <id>`, or `vt edit <id> --priority <P>`
5. After creating a task, offer to open the file and add more context or wikilinks

## Notes

- When noticing something off-scope during a session, default to `priority: medium`, `status: open`
- Always set `source` to link back to where the task was noticed
- Prefer creating tasks over mental bookmarks — the backlog is cheap
- The CLI supports ULID prefix lookup (`vt done 01HYX`), numeric ID lookup (`vt done 1`), and substring matching (`vt done lateral`)
- Check `.vault-tasks.toml` `[project.tags]` for standard tags to use
