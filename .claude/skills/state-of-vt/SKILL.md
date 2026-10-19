---
name: state-of-vt
description: Outcome-level decision brief for vault-tasks — pulls npm/PyPI downloads, GitHub issues, PRs and dependents, CI health, the retrieval eval and backlog staleness, then writes what changed, why, the top 3 decisions with for/against, and one process change to try. Read-only. Use when the user says "/state-of-vt", "how is vt doing", "what should I work on next", or before planning a release.
---

> If `SKILL.local.md` exists in this directory, read it first. Local instructions extend this behavior. Where they conflict, local wins.

# /state-of-vt

Aim the next session at outcomes (people installing, using and reporting on
`vt`), not at whatever the backlog happens to list. **Read-only**: never edit
tracked files, comment, label, close, merge, release or publish. Local
preparation that only touches untracked state (`git fetch`, building the
gitignored `dist/`) is allowed. Output goes to chat.

## Steps

1. **Collect.** From the repo root:
   ```sh
   git fetch --tags origin            # so release/unreleased numbers are current
   npm run build                      # the eval runs against dist/
   node scripts/state-of-vt.mjs > "${TMPDIR:-/tmp}/state-of-vt.json"
   ```
   The script is the source of truth for every number; read the JSON, never
   re-derive figures from memory. A section shaped `{ "error": ... }` is a
   missing source — say which one and carry on.

2. **What changed.** Compare periods only where the snapshot has both:
   downloads per registry (npm `last_30d` vs `prior_30d`; PyPI uses the
   `no_mirrors` figures) and eval deltas against `baseline.json`. Report the
   rest as current levels, not deltas: open issues, issues closed and PRs
   merged in the last 30 days, `main_pass_rate` (latest 10 completed runs on
   `main`), unreleased commits since the latest tag. Show deltas as numbers
   with a sign, not adjectives.

3. **Why.** For each material change, give the most likely cause and label it
   **known** (traceable to a commit, release date, issue) or **guess**.
   Downloads in the tens are dominated by bots and CI mirrors: say so instead
   of narrating a trend from noise (rule of thumb: a change under ~2× on
   counts under 100 is not a trend).

4. **Top 3 decisions.** Pick the three open questions where a decision now
   most changes outcomes. Candidates come from: open issues (oldest and most
   commented first), unreleased commits (cut a release?), eval gaps (default
   search mode, stemmer in backlog `0004`, embedding defaults), CI health,
   and backlog items older than 60 days (keep, re-scope, or `wont-do`). For
   each: the decision in one line, **For**, **Against**, the evidence from the
   snapshot, and your recommendation.

5. **One process change to try.** A single, concrete change to how the
   maintainer works next cycle (a check, a cadence, a habit), with how to tell
   in 30 days whether it worked.

## Output format

```
## State of vt — YYYY-MM-DD

### Numbers
| metric | last 30d | prior 30d | Δ |
...

### What changed, and why
- **<change>** — <cause> (known|guess)

### Decisions
1. **<decision>** — recommend: <x>
   - For: ...
   - Against: ...
   - Evidence: <snapshot fields>

### Process change to try
<one change> — check in 30 days by <measure>.

### Missing data
<sources that errored, if any>
```

## Notes

- Dependents: GitHub has no dependents API; the script reports npm's
  `dependents` count and a `gh search code` count of `package.json` files
  naming `vault-tasks`. Both are rough lower bounds.
- Traffic views/clones are owner-only `gh api` endpoints and cover 14 days.
- The retrieval eval and its target are documented in
  `evals/retrieval/README.md`.
