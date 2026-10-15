---
title: CI takes 14 minutes; cache dependencies
status: open
priority: medium
tags:
  - ci
  - performance
created: 2026-08-17
source: "[[fixture]]"
---
# CI takes 14 minutes; cache dependencies

Every pipeline run reinstalls node_modules and rebuilds the Docker image from scratch. Cache the package manager store and use layer caching to get it under five minutes.
