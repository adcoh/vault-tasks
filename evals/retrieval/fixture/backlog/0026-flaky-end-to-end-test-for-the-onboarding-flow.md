---
title: Flaky end-to-end test for the onboarding flow
status: open
priority: medium
tags:
  - ci
  - testing
  - bug
created: 2026-09-18
source: "[[fixture]]"
---
# Flaky end-to-end test for the onboarding flow

The Playwright onboarding spec fails about one run in eight with a timeout on the welcome modal. Wait on the network idle event rather than a fixed sleep, and record a trace on failure.
