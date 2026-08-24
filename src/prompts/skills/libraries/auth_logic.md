---
id: auth_logic
title: Authentication and authorization logic
summary: Test login, recovery, MFA, session, role, and tenant decisions as stateful security properties.
category: authentication
level: standard
signals: ["login", "session", "role", "tenant", "recovery", "mfa", "authorization"]
technologies: ["web", "rest", "oauth", "jwt"]
related: ["account_recovery", "mfa_logic", "session_management", "jwt_logic", "bola", "csrf"]
---

## Workflow

Model states, transitions, identities, roles, tenants, and invalid transitions from observed traffic. Compare successful and failed authentication, session rotation, logout, recovery, MFA enrollment/challenge, role changes, and tenant switching. Preserve cookies/tokens as redacted labels and use disposable accounts.

## Verification rules

A finding requires a reproducible security-property failure, not merely a different error or a client-side control. Confirm replay, fixation, bypass, or privilege change with an independent identity/control and record cleanup.

## Stop conditions

Stop after minimal proof, account lockout risk, unexpected notification, or any request that could affect a real user's access.
