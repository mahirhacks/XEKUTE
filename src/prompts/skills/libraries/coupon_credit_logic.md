---
id: coupon_credit_logic
title: Coupon and credit logic
summary: Test discount, credit, balance, redemption, and refund invariants with sandbox or disposable values.
category: business-logic
level: advanced
signals: ["coupon", "credit", "balance", "discount", "redeem", "refund"]
technologies: ["web", "rest", "payment api"]
related: ["payment_logic", "business_logic", "race_conditions"]
---

## Workflow

Map issuance, ownership, expiry, stacking, replay, and ledger states. Use one disposable code or credit and compare normal, duplicate, boundary, and unauthorized identity controls. Confirm server-side balance and cleanup.
