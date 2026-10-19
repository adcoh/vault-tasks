---
title: Stripe webhook retries create duplicate subscriptions
status: open
priority: high
tags:
  - billing
  - bug
created: 2026-09-27
source: "[[fixture]]"
---
# Stripe webhook retries create duplicate subscriptions

When our endpoint is slow Stripe retries the event and we insert a second subscription row. Make the handler idempotent on the event id.
