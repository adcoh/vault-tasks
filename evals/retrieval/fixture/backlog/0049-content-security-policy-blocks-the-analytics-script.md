---
title: Content Security Policy blocks the analytics script
status: open
priority: low
tags:
  - security
  - frontend
created: 2026-05-23
source: "[[fixture]]"
---
# Content Security Policy blocks the analytics script

After tightening CSP the privacy-friendly analytics stopped loading. Add its domain to script-src and connect-src rather than loosening to unsafe-inline.
