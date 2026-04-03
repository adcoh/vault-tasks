---
name: build-log
description: Capture what was built, broken, learned, and decided in a session. Use at the end of any Claude Code session, or when the user says "log this session", "write up what we did", or "save the session".
---

> If `SKILL.local.md` exists in this directory, read it first. Local instructions extend this behavior. Where they conflict, local wins.

# /build-log

## Steps

1. Ask the user: "Quick summary of today's session — what were you working on?" if not already clear from context
2. Review the current conversation or any context the user provides
3. Create a topic page in `{{journal_dir}}/YYYY/` with filename: `YYYY-MM-DD HHMM <Topic>.md`
4. Structure the note with these sections:

```
## What we built
[Concrete output — what works now that didn't before]

## What broke / didn't work
[Errors hit, approaches abandoned, dead ends — these are valuable]

## What I learned
[New concepts, patterns, insights — especially things that surprised me]

## Decisions made
[Any choices made during the session with brief rationale]

## Next session
[The single most important thing to pick up next time]
```

5. Add `[[wikilinks]]` to relevant area/project CONTEXT.md files
6. **Extract backlog tasks from the build log:**
   a. **Scan "Next session" section** — extract each actionable item. For each one, search existing backlog with `vt search "<keywords>"` to check for duplicates. If no similar task exists, create one via `vt new "<item>" --priority medium --source "[[build-log-title]]"`. If a similar task already exists, mention it instead of creating a duplicate.
   b. **Scan "What broke / didn't work" section** — look for unresolved issues. If something broke and was NOT fixed during the session (skip items with "fixed", "resolved", or "workaround" language), dedup-search and create a task for it the same way.
   c. **Check brief tasks** — if a `/brief` was run at session start, check whether any tasks from that brief were addressed during the session. For each completed task, offer to mark it done via `vt done <id>`.
   d. **Report** — summarize what tasks were created, what duplicates were skipped, and what existing tasks were offered for completion.
7. Offer to update the relevant project or area CONTEXT.md with any status changes

## Notes

- "What broke" is as important as "what worked" — future-you needs to know what was tried
- Keep "what I learned" focused on transferable knowledge, not just session-specific facts
- One clear "next session" item prevents the cold-start problem next time
- Tasks are deduped against the existing backlog before creation. All tasks default to `priority: medium` with `source` linking back to the build log.
