---
id: user_account_logic
title: User-account workflow logic
summary: Test profile, email, password, recovery, invitation, role, and tenant-account transitions for authorization and state flaws.
category: business-logic
level: advanced
signals: ["account", "profile", "email", "password", "invite", "role", "tenant"]
technologies: ["web", "rest", "identity"]
related: ["auth_logic", "account_recovery", "mfa_logic", "bola", "business_logic"]
---

## Workflow

Map account states and identity ownership before testing. Compare self, peer, administrator, pending-invite, removed-user, and tenant-admin controls for profile edits, email changes, password changes, recovery, invitations, role changes, and deletion. Use disposable identities and verify notifications and audit records.

## Verification rules

Confirm the server accepted an operation outside the principal's authority or produced a reusable credential/state transition without the required proof. Distinguish intended self-service from cross-account impact.
