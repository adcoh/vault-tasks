---
title: Add TOTP two-factor login
status: in-progress
priority: high
tags:
  - auth
  - security
created: 2026-03-12
source: "[[fixture]]"
---
# Add TOTP two-factor login

Support authenticator apps (Google Authenticator, 1Password) as a second factor at sign-in. Store the shared secret encrypted, show a QR code during enrollment, and generate ten single-use recovery codes.
