---
title: Sync API returns 500 when payload has unknown habit id
status: open
priority: medium
tags:
  - sync
  - api
  - bug
created: 2026-07-25
source: "[[fixture]]"
---
# Sync API returns 500 when payload has unknown habit id

The server throws on a habit id it does not know (deleted on another device). Return a 409 with the list of tombstoned ids so the client can drop them.
