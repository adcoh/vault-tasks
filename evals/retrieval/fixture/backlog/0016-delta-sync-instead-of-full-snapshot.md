---
title: Delta sync instead of full snapshot
status: open
priority: medium
tags:
  - sync
  - api
  - performance
created: 2026-08-26
source: "[[fixture]]"
---
# Delta sync instead of full snapshot

Each sync uploads the entire history, around 400 KB for long-time users. Send only changes since the last server cursor and paginate the download.
