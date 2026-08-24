---
id: mass_assignment
title: Mass assignment
summary: Test whether unexpected writable fields change authorization, ownership, role, or business state.
category: authorization
level: standard
signals: ["json body", "model fields", "role", "owner", "is_admin"]
technologies: ["rest", "orm", "web"]
related: ["bola", "business_logic", "api_schema_abuse"]
---

## Workflow

Compare documented and observed writable fields with server responses and object schemas. Add one non-sensitive candidate field at a time to a disposable update and verify server-side state, ownership, and audit records.
