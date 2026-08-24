---
id: mfa_logic
title: MFA workflow logic
summary: Test enrollment, challenge, recovery, device trust, replay, and step-up enforcement.
category: authentication
level: advanced
signals: ["mfa", "otp", "totp", "webauthn", "step up", "device"]
technologies: ["web", "rest", "identity"]
related: ["auth_logic", "account_recovery", "session_management"]
---

## Workflow

Compare pre- and post-MFA sessions, enrollment/recovery states, trusted devices, replay, rate limits, and privileged actions. Use disposable identities and stop on lockout or notification risk.
