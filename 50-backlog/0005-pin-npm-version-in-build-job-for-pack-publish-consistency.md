---
title: Pin npm@^11.5.1 in the build job too for pack/publish consistency
status: open
priority: medium
tags:
  - ci
  - release
created: 2026-06-10
source: "[[2026-06-10 0245 BM25 Search Module and npm Trusted-Publishing Saga]]"
---
# Pin npm@^11.5.1 in the build job too for pack/publish consistency

PR #24 added `npm install -g 'npm@^11.5.1'` to the `publish-npm` job so trusted
publishing's OIDC auto-detection works. But the `build` job (which runs `npm pack`
to produce the tarball that `publish-npm` later uploads) still uses whatever npm
`actions/setup-node@v6` + Node 22 bundles (currently 10.x).

So the tarball is **packed** with one npm version and **published** with another.
This works today, but it's a latent inconsistency:

- Any future `npm pack` behavior change (file inclusion, `package.json`
  normalization, integrity hashing) would silently differ between the two jobs.
- Debugging is harder when the two halves of the release use different CLIs.

Consider adding the same `npm install -g 'npm@^11.5.1'` step (or a shared composite
action / reusable step) to the `build` job in `.github/workflows/publish.yml`, so
pack and publish run on the same pinned npm.

Low urgency — purely defensive consistency, not a known bug. See
`[[npm Trusted Publishing from GitHub Actions]]` for the surrounding context.
