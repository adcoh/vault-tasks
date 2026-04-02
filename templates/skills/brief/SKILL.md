---
name: brief
description: Pre-session briefing — surfaces open tasks, last session context, and relevant evergreen notes. Use at session start or when the user says "brief me", "what's open", or "where did we leave off".
---

> If `SKILL.local.md` exists in this directory, read it first. Local instructions extend this behavior. Where they conflict, local wins.

# /brief

## Steps

1. **Open tasks** — run `vt list` and present results sorted by priority (high > medium > low), grouped by tag. Keep it scannable — one line per task with `[[wikilinks]]` to the task file.

2. **Last session** — find the most recent build log in `01-journal/YYYY/` (look for files with `build-log` in their tags/frontmatter). Read its **Next session** section and surface it prominently — this is the warm-start hook.

3. **Active projects** — scan `20-projects/` for in-progress work. For each folder project, read `CONTEXT.md` and extract the current status. For single-file projects, read the frontmatter/first section. Show one-liner status per project.

4. **Relevant evergreen notes** — if the user states what they're working on today, search `30-evergreen/` by keyword and surface 3-5 related notes with brief excerpts. Skip this step if no topic is given.

5. **Stale threads** — run `vt stale`. Flag these as needing triage (close, reprioritize, or act on).

## Output Format

Present as a concise briefing, not a wall of text:

```
## Briefing — YYYY-MM-DD

### Pick up where you left off
[Last session's "Next session" item — the single most important thing]

### Open tasks (N)
**high**
- [ ] Task title — [[0001-task-slug]]

**medium**
- [ ] Task title — [[0002-task-slug]]

### Active projects
- **Project Name** — one-liner status

### Stale threads (N)
- [[0003-old-task]] — 21 days old, needs triage

### Related notes
- [[Evergreen note title]] — brief excerpt
```

## Notes

- This is a read-only orientation tool. Don't create or modify files.
- Prioritize the "pick up where you left off" section — that's the highest-value info at session start.
- If any step fails (e.g., no build logs exist yet), skip it gracefully.
- Keep the whole briefing under ~40 lines. Link to sources so the user can drill down.
