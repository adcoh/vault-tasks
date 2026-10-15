---
title: CLI crashes when config file has CRLF line endings
status: open
priority: high
tags:
  - cli
  - bug
  - windows
created: 2026-05-14
source: "[[fixture]]"
---
# CLI crashes when config file has CRLF line endings

A user on Windows edited the config in Notepad and every command now fails with 'unknown key token\r'. Normalise line endings before parsing.
