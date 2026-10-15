---
title: App icon looks blurry on Android home screen
status: open
priority: low
tags:
  - mobile
  - ui
  - bug
created: 2026-06-15
source: "[[fixture]]"
---
# App icon looks blurry on Android home screen

The manifest only has a 192px icon. Provide 512px and a maskable variant so the launcher can crop it properly.
