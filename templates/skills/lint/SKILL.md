---
name: lint
description: Audit the vault for orphan notes, broken wikilinks, missing
  concept pages, convention drift, and potential contradictions. Read-only —
  presents findings, never auto-edits. Use when the user says "lint the
  vault", "health check", "find orphans", or "audit the notes".
---

# /lint

The Maintain pillar of the Karpathy LLM-Wiki pattern. `vt lint` is the
mechanical engine; this skill is the conversation layer that turns its
output into a triage.

## Steps

1. Run the mechanical checks. The CLI does broken wikilinks, orphan
   evergreens, stale references, and convention drift in one pass:
   ```bash
   vt lint
   ```
   The last line prints a `SUMMARY:` that feeds into step 5. Use
   `vt lint --only broken` to iterate fast on a single check, or
   `vt lint --scope 30-evergreen` to narrow the focus to a subtree.

2. Qualitative checks the script does not do — do these by hand after
   reading the script output:
   - **Missing concept pages** — scan evergreens for bolded terms or
     repeated capitalised phrases that appear in 3+ evergreens but have no
     dedicated note. Suggest candidates.
   - **Index and log health** — confirm `index.md` lists every evergreen
     and area; confirm `log.md` has recent entries for recent commits.
   - **Potential contradictions** — optionally, pick 2–3 clusters of
     tightly linked evergreens and read them together; flag claims that
     disagree or overlap awkwardly. Expensive; skip unless asked.
   - **Tag-set drift** — the script checks for presence of `tags:`; it
     does not check the standard set. Eyeball this against the canonical
     tag set; flag any evergreen using a tag not in that set.

3. Present findings as a single report grouped by category. Lead with the
   `HIGH-LEVERAGE FIXES` section from the script output — these are the
   single-action fixes that close many broken links at once. Then the
   per-target broken-link detail, then orphans, stale, and drift. Add the
   qualitative findings as a separate section. Use wikilinks so the user
   can jump to sources. Do not edit anything.

4. Offer next steps — `/expand` on concept candidates, opening specific
   files for review, or a follow-up `/lint --scope <dir>` against a
   specific subtree.

5. Append a log entry with the summary line from the CLI:
   ```
   ## [YYYY-MM-DD] lint | broken:N orphans:N stale:N drift:N — <one-line note>
   ```

## How `vt lint` resolves wikilinks (why naive grep misses this)

The CLI handles all of these; if you ever extend the checks by hand, do
not regress on them:

- **Case-insensitive and whitespace-agnostic.** `[[Abstract language enables
  ideological projection]]` resolves to
  `abstract-language-enables-ideological-projection.md`. Space, hyphen,
  underscore, and colon are interchangeable; the lookup lowercases both
  sides before comparing.
- **Resolves against `title:` frontmatter and `aliases:`, not just the
  filename.** Many evergreens use the Title-Case wikilink form because
  that matches the note's title frontmatter field. A grep for
  exact-filename matches will produce false positives in the hundreds.
- **Path-form links resolve to that path.** `[[10-areas/investing/CONTEXT]]`
  means the file at `10-areas/investing/CONTEXT.md`.
- **Partial-path tails resolve by suffix match when unique.**
  `[[parenting/CONTEXT]]` → `10-areas/parenting/CONTEXT.md`.
- **`|alias` and `#anchor` suffixes are stripped before resolution.**
  `[[foo|bar]]` resolves `foo`; `[[foo#heading]]` resolves `foo`.

## Template placeholders to skip

Skill/rule files and `CLAUDE.md` contain example wikilinks
(`[[YYYY-MM-DD]]`, `[[<filename>]]`, `[[note-name]]`, `[[wikilink]]`,
`[[target]]`, `[[0001-task-slug]]`, etc.) that are documentation, not real
links. The CLI filters these via `[lint] template_source_dirs` and
`template_patterns` in `.vault-tasks.toml`; if you extend the checks by
hand, preserve the exclusion.

## Per-file opt-outs

A file can opt out of individual checks via flat frontmatter keys:

```yaml
---
lint_orphan_ok: true   # don't flag this file as an orphan
lint_stale_ok: true    # don't flag this file as a stale reference
lint_drift_ok: true    # don't enforce evergreen conventions on this file
---
```

Use sparingly — opt-outs are debt. They are most appropriate for
intentionally-orphan inboxes, drafts, or imported notes that are not
expected to fit the local conventions.

## CLI flags

```
vt lint                          # full pass, human-readable output
vt lint --only broken            # one check at a time during cleanup
vt lint --scope 30-evergreen     # restrict to a subtree
vt lint --json                   # machine-readable (CI, dashboards)
vt lint --quiet                  # only the SUMMARY line
vt lint --no-suggestions         # skip "did you mean?" (faster on big vaults)
```

Exit codes: `0` clean, `1` issues found, `2` configuration or I/O error.

## Notes

- **Read-only.** This skill never writes to notes. The only file it may
  append to is `log.md`.
- Present findings; let the user decide what to act on. Mirrors the style
  of `/consolidate`.
- Keep the human-report tight — one line per finding.
- Default to a full lint. Accept narrowed scope ("just evergreens", "just
  investments") by passing `--scope`.
