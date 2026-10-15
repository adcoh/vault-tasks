---
title: Handle failed card payments gracefully
status: open
priority: medium
tags:
  - billing
created: 2026-02-11
source: "[[fixture]]"
---
# Handle failed card payments gracefully

When a renewal charge is declined we immediately lock the account. Use Stripe's smart retries, email the user, and allow a 7-day grace period before downgrading.
