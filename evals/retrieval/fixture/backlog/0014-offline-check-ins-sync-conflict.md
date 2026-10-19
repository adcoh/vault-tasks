---
title: Offline check-ins sync conflict
status: open
priority: high
tags:
  - sync
  - bug
  - mobile
created: 2026-06-24
source: "[[fixture]]"
---
# Offline check-ins sync conflict

If a user checks in on the phone while offline and also on the laptop, the second sync overwrites the first. Merge per habit per day instead of last-write-wins on the whole document.
