---
title: Nightly database backups to object storage
status: done
priority: high
tags:
  - database
  - infra
  - ops
created: 2026-05-14
source: "[[fixture]]"
---
# Nightly database backups to object storage

pg_dump every night, compress, encrypt with age, upload to the bucket with 30-day lifecycle. Restore-test monthly into a scratch instance.
