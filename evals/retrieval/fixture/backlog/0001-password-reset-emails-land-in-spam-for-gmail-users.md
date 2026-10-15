---
title: Password reset emails land in spam for Gmail users
status: open
priority: high
tags:
  - auth
  - email
created: 2026-02-11
source: "[[fixture]]"
---
# Password reset emails land in spam for Gmail users

Users on Gmail report the reset link never arrives; it is in the spam folder. SPF passes but DKIM is not set up for the transactional sending domain. Add DKIM and DMARC records and re-test with mail-tester.
