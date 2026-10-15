---
title: Migrate from Heroku to Fly.io
status: open
priority: medium
tags:
  - infra
  - ops
  - cost
created: 2026-06-15
source: "[[fixture]]"
---
# Migrate from Heroku to Fly.io

Hosting bill tripled after the plan change. Move the API and Postgres to Fly, keep the same domain, do a staged cutover with a read-only window of under five minutes.
