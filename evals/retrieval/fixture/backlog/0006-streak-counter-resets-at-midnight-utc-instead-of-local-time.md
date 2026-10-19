---
title: Streak counter resets at midnight UTC instead of local time
status: open
priority: high
tags:
  - habits
  - bug
  - timezone
created: 2026-07-16
source: "[[fixture]]"
---
# Streak counter resets at midnight UTC instead of local time

A user in Sydney lost a 90-day streak because the day boundary is computed in UTC. Compute the check-in day in the user's IANA timezone and backfill the streaks that were broken by this.
