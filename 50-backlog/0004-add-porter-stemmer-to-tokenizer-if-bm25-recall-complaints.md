---
title: Add Porter stemmer to tokenizer if BM25 recall complaints surface
status: open
priority: low
tags:
  - search
  - tokenizer
  - conditional
created: 2026-05-28
source: "[[2026-05-28 PR-15 BM25 hostile review]]"
---
# Add Porter stemmer to tokenizer if BM25 recall complaints surface

## Context

The current BM25 tokenizer in `src/search/tokenize.ts` is intentionally stem-free
(see PR #15 hostile review discussion). This keeps it zero-dep and
language-agnostic but means `auth` does not match `authentication`,
`test` does not match `testing`, `deploy` does not match `deployment`, etc.

Title-doubling in `src/search/bm25.ts` masks the pain for short queries against
short titles, but as task vaults grow — especially with longer task bodies —
the recall gap will become visible. The plan is to add stemming only when the
gap is measurably hurting real users, not preemptively, because:

- A bad stemmer (Porter conflates `university` and `universe`) trades recall
  for precision in surprising ways.
- Adding a stemmer dep would violate the zero-runtime-dep rule
  (see `CLAUDE.md`).
- A Porter snowball implementation in pure TS is ~60 LOC and zero dep,
  so the "library or homegrown" tension does not apply here.

## Trigger conditions (act on this task when ANY of the following is true)

- Three or more users report that an obvious query (e.g., `auth`,
  `test`, `deploy`) misses tasks that contain the morphological variant.
- A user explicitly asks "why doesn't this find X?" where X is a stem
  of their query, more than twice.
- BM25 mode adoption stalls and informal feedback points at recall.
- We add semantic / hybrid search (Phase 2): at that point the stemmer
  becomes an alternative to embedding-based recall rather than a band-aid,
  and it's worth comparing them.

## Acceptance criteria

- [ ] `src/search/tokenize.ts` exposes an optional stemming pass behind
      a config flag (`[search] stemmer = "porter" | "none"`, default `"none"`
      until v1 ships, then re-evaluate the default).
- [ ] Porter stemmer implemented as pure TS in `src/search/stemmer.ts`,
      zero new runtime deps.
- [ ] BM25Index applies the stemmer to BOTH document tokens AND query
      tokens (single source of truth in `tokenize.ts`, so this falls out
      automatically).
- [ ] CLI tests cover the canonical recall cases: `auth` finds tasks
      containing `authentication`; `test` finds `testing`; query
      `deployments` finds tasks tagged `deploy`.
- [ ] Adversarial tests cover known stemmer pitfalls: `university` and
      `universe` should NOT collapse if we can avoid it (light stemmer
      variants exist); document the trade-off in `tokenize.ts`.
- [ ] README documents the option, the default, and the trade-off.
- [ ] The pre-fix BM25 ranking is preserved when `stemmer = "none"`
      (regression coverage via existing BM25 tests).
- [ ] Per-language behavior is honest: Porter is English-only.
      Non-English tasks should pass through unchanged.

## Out of scope (resist scope creep when picking this up)

- Replacing BM25 with a third-party full-text engine (lunr, minisearch,
  flexsearch). The whole reason for this task existing is that we have
  a small recall gap, not that we want a different engine. See PR #15
  discussion for the cost-benefit; the line is "complaints from users we
  could not reasonably fix with another ~200 LOC".
- Adding stop-word lists. BM25's IDF already handles common words; a
  stop-word list mostly saves a few KB of postings, which is irrelevant
  at the corpus sizes this package targets.
- Snowball stemmers for non-English languages. The cost-benefit doesn't
  exist until we have non-English users asking.

## Alternatives considered (already)

- **lunr / minisearch / flexsearch**: 20–50KB minified + transitive deps,
  partial maintenance status, designed for long-lived web indexes rather
  than one-shot CLI invocations. Doesn't fit the package's zero-dep ethos.
- **Prefix indexing** (index every 3+ char prefix of each token): cheap
  recall boost but ~4× index size and pollutes IDF. Worth considering
  if Porter has language-bias problems.
- **Character bigrams**: even broader recall, same IDF pollution concern.
- **Doing nothing and waiting for vectors (Phase 2)**: vectors will close
  this gap for free if/when they ship, BUT they require an embedder peer
  dep and a persisted index. Porter is a much smaller intervention if the
  user base never wants the vector stack.

## Implementation pointers

- Stemmer goes in `src/search/stemmer.ts` (new file).
- Tokenizer changes in `src/search/tokenize.ts:tokenize()` — apply stemmer
  as the final step before the `length > 1` filter.
- Config plumbing in `src/config.ts` under a new `[search]` section
  (Phase 2 of the original plan adds this section anyway for the
  embedder; coordinate with that work to avoid two config rewrites).
- Test file: `src/tests/stemmer.test.ts`.
- Public BM25Index API stays unchanged — stemming is a tokenizer concern,
  not an index-construction concern.

## Related

- [[PR-15]] (BM25 module + hostile review)
- `src/search/tokenize.ts`
- `src/search/bm25.ts`
