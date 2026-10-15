---
title: Reminder notifications fire twice on Android
status: open
priority: high
tags:
  - notifications
  - bug
  - mobile
created: 2026-03-21
source: "[[fixture]]"
---
# Reminder notifications fire twice on Android

Some Android Chrome users get each reminder two times. Probably two service worker registrations after the update; dedupe by tag and unregister the stale worker.
