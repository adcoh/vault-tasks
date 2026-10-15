---
title: Postgres connection pool exhausted under load
status: open
priority: high
tags:
  - database
  - performance
  - infra
created: 2026-03-12
source: "[[fixture]]"
---
# Postgres connection pool exhausted under load

At peak the API hits 'too many clients'. Each request opens its own client. Put PgBouncer in transaction mode in front of Postgres and cap the app pool at 10.
