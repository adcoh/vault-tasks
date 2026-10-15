---
title: "Add index on checkins(user_id, day)"
status: open
priority: medium
tags:
  - database
  - performance
created: 2026-04-13
source: "[[fixture]]"
---
# Add index on checkins(user_id, day)

The stats page does a sequential scan over all check-ins. A composite index on user and day should take it from 800 ms to a few ms; verify with EXPLAIN ANALYZE.
