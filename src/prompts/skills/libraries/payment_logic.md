---
id: payment_logic
title: Payment workflow logic
summary: Test authorization, amount, currency, state, replay, refund, and entitlement rules around payment workflows.
category: business-logic
level: advanced
signals: ["payment", "checkout", "invoice", "refund", "currency", "coupon", "entitlement"]
technologies: ["web", "rest", "webhook", "stripe", "payment api"]
related: ["business_logic", "race_conditions", "coupon_credit_logic", "bola", "csrf"]
---

## Prerequisites

Use a test merchant, sandbox account, disposable order, and explicit authorization for any state-changing operation. Map server-side order, payment, refund, webhook, and entitlement states first.

## Techniques

- Compare client amount/currency/product values against server-calculated records.
- Test ownership and role controls on invoices, refunds, payment methods, and entitlement endpoints.
- Check replay, duplicate callbacks, cancellation/refund ordering, coupon limits, and state transitions with harmless sandbox values.
- Compare browser-visible success with server-side ledger and final entitlement state.

## Verification rules

Confirm a real unauthorized financial or entitlement state change and preserve before/after evidence. Do not use production payment instruments or maximize impact.
