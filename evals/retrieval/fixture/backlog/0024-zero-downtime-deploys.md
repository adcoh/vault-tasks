---
title: Zero-downtime deploys
status: open
priority: medium
tags:
  - infra
  - ci
  - ops
created: 2026-07-16
source: "[[fixture]]"
---
# Zero-downtime deploys

Deploys currently restart the only machine and drop in-flight requests. Run two instances, health-check the new one, then shift traffic before stopping the old.
