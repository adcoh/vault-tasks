---
title: Session cookie missing SameSite attribute
status: open
priority: medium
tags:
  - auth
  - security
created: 2026-04-13
source: "[[fixture]]"
---
# Session cookie missing SameSite attribute

The session cookie is set without SameSite, so browsers default differently. Set SameSite=Lax and Secure, and check that the OAuth callback still keeps the user signed in.
