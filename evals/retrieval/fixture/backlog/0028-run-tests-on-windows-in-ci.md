---
title: Run tests on Windows in CI
status: open
priority: low
tags:
  - ci
  - testing
  - cli
created: 2026-02-20
source: "[[fixture]]"
---
# Run tests on Windows in CI

The CLI has Windows users but the pipeline only runs Linux. Add a windows runner to the matrix and fix path separator assumptions.
