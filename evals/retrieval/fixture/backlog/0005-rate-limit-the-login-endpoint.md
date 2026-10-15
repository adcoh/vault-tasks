---
title: Rate-limit the login endpoint
status: open
priority: high
tags:
  - auth
  - api
  - security
created: 2026-06-15
source: "[[fixture]]"
---
# Rate-limit the login endpoint

Credential stuffing attempts hit /login thousands of times an hour from rotating IPs. Add a sliding-window limiter keyed by account and by IP, return 429 with Retry-After, and alert when it trips.
