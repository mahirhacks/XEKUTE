---
id: race_conditions
title: Race conditions
summary: Test concurrent state changes or one-time operations with bounded, low-volume parallel requests.
category: business-logic
level: advanced
signals: ["race", "concurrent", "one-time", "duplicate", "quota"]
technologies: ["web", "rest", "payment api"]
related: ["business_logic", "payment_logic", "rate_limit_abuse"]
---

## Workflow

Use a disposable resource and establish a serial baseline. Send the minimum authorized concurrent requests needed to test an invariant, then inspect final state, ledger, notifications, and cleanup. Do not create uncontrolled load.
