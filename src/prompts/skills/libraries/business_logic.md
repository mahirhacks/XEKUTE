---
id: business_logic
title: Business-logic abuse
summary: Test whether workflow rules, state transitions, quotas, ownership, or sequencing can be bypassed with valid requests.
category: business-logic
level: standard
signals: ["workflow", "state", "approval", "quota", "discount", "order", "invite"]
technologies: ["web", "rest", "graphql", "mobile api"]
related: ["payment_logic", "user_account_logic", "race_conditions", "rate_limit_abuse", "bola"]
---

## Workflow

Model valid states, actors, invariants, and side effects from traffic and artifacts. Test one transition or ordering rule at a time using disposable records. Compare direct navigation, replay, omission, duplication, role changes, and benign boundary values against the normal flow.

## Verification rules

Confirm a rule or invariant was bypassed and identify the resulting authorized business impact. A surprising but intended state or client-only validation is not a finding.
