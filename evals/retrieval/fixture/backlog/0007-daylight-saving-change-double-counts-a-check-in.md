---
title: Daylight saving change double-counts a check-in
status: open
priority: medium
tags:
  - habits
  - bug
  - timezone
created: 2026-08-17
source: "[[fixture]]"
---
# Daylight saving change double-counts a check-in

On the night clocks go back, the 01:00-02:00 hour happens twice and a check-in logged in that hour is counted for two days. Store check-ins as instants and derive the local date once.
