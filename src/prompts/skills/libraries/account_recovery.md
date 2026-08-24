---
id: account_recovery
title: Account recovery security
summary: Test recovery tokens, identity proof, expiry, replay, and notification transitions using disposable accounts.
category: authentication
level: advanced
signals: ["reset", "recovery", "email", "token", "otp"]
technologies: ["web", "rest", "email"]
related: ["auth_logic", "user_account_logic", "mfa_logic"]
---

## Workflow

Map request, token issuance, verification, expiry, replay, password/session rotation, and notification states. Compare self, peer, expired, reused, and altered tokens with redacted labels. Confirm only the minimum authorized account transition.
