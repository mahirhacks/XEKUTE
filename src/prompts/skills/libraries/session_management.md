---
id: session_management
title: Session management
summary: Test session creation, rotation, invalidation, cookie flags, fixation, and concurrent-session behavior.
category: authentication
level: standard
signals: ["cookie", "session", "token", "logout", "fixation"]
technologies: ["web", "rest", "browser"]
related: ["auth_logic", "csrf", "jwt_logic"]
---

## Workflow

Record redacted session labels across login, privilege change, logout, password change, recovery, and expiry. Compare old/new tokens and browser cookie attributes with safe controls. Require a reproducible unauthorized session or credential reuse condition.
