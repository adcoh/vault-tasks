---
name: weekly-review
description: Automated weekly review — consolidates journal entries, expands evergreen notes, creates/triages backlog tasks, updates project context, and opens a PR. Use weekly or when the user says "weekly review", "run the review", or "what happened this week".
---

> If `SKILL.local.md` exists in this directory, read it first. Local instructions extend this behavior. Where they conflict, local wins.

# /weekly-review

This skill runs the full knowledge extraction pipeline. It can be invoked manually or by automated scheduling. All output goes on a branch and is submitted as a PR for review.

## Steps

1. **Create branch** — `git checkout -b weekly-review/YYYY-MM-DD` from main.

2. **Determine range** — find the most recent weekly review note in `01-journal/YYYY/` (files with `weekly-review` tag). Use its `range_end` property as the start date. If none found, use the earliest journal entry date. The end date is today.

3. **Gather inputs:**
   - Journal entries in `01-journal/YYYY/` filtered to the date range
   - Read each entry for themes, open threads, and actionable items
   - Current backlog: `vt list`
   - Git log for the period: `git log --since=<start> --format="%h %ad %s" --date=short`

4. **Run consolidation** — identify recurring themes, evergreen candidates, and open threads across the journal entries.

5. **Expand evergreen notes** — for each evergreen candidate:
   - Check for duplicates in `30-evergreen/`
   - Write to `30-evergreen/` with statement-style title
   - Use this frontmatter:
     ```yaml
     ---
     title: "<statement-style title>"
     tags:
       - <relevant tags>
     generated: weekly-review
     review_date: YYYY-MM-DD
     ---
     ```
   - Include `[[wikilinks]]` to source entries and related notes
   - End with a **Related** section

6. **Create backlog tasks** — for each open thread:
   - Search existing backlog: `vt search "<keywords>"`
   - If no match: `vt new "<item>" --priority medium --source "[[YYYY-MM-DD Weekly Review]]"`
   - If thread appeared in 2+ entries, use `--priority high`

7. **Triage existing tasks:**
   - Run `vt list` and check each open task against the week's build logs and git log
   - If a task was clearly addressed: `vt done <id>`
   - Run `vt stale` and flag results
   - Run `vt archive` to move completed tasks out of the active backlog

8. **Update CONTEXT.md files** — for each area or project that had activity this week, update its CONTEXT.md to reflect progress.

9. **Write the weekly review note** — create `01-journal/YYYY/YYYY-MM-DD Weekly Review.md`:
    ```yaml
    ---
    title: "Weekly Review — YYYY-MM-DD"
    date: YYYY-MM-DD
    tags:
      - weekly-review
    range_start: YYYY-MM-DD
    range_end: YYYY-MM-DD
    evergreen_created: <count>
    tasks_created: <count>
    tasks_completed: <count>
    ---
    ```
    Body sections:
    - **This week's work** — summary from build logs, with `[[wikilinks]]`
    - **Themes** — recurring patterns identified
    - **Evergreen notes created** — list with `[[wikilinks]]`
    - **Tasks created** — list with IDs and `[[wikilinks]]`
    - **Tasks completed** — list of what was closed
    - **Stale tasks** — flagged for triage
    - **Open threads carried forward** — unresolved items for next week

10. **Commit and push:**
    - Stage all changes
    - Commit: `docs: weekly review YYYY-MM-DD`
    - Push: `git push -u origin weekly-review/YYYY-MM-DD`
    - Open PR: `gh pr create --title "Weekly Review — YYYY-MM-DD" --body "<structured summary>"`

## Notes

- This skill is designed to run fully automated (no interactive prompts). All decisions are made by the pipeline.
- Evergreen notes get `generated: weekly-review` in frontmatter so they can be distinguished from hand-written notes.
- Tasks are always deduped against the existing backlog before creation.
- The PR is the review checkpoint. All changes are visible in the diff.
- If running manually, you can still intervene at any step.
