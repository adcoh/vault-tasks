---
title: Landing page loads 2 MB of JavaScript
status: open
priority: medium
tags:
  - performance
  - frontend
created: 2026-06-24
source: "[[fixture]]"
---
# Landing page loads 2 MB of JavaScript

Lighthouse score is 41 on mobile. The marketing page ships the whole app bundle. Split the bundle by route and lazy-load the chart library.
