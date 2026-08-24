---
id: bfla
title: Broken function level authorization
summary: Test whether a lower-privileged principal can invoke an administrative or privileged function.
category: authorization
level: standard
signals: ["admin", "role", "privileged", "management", "function"]
technologies: ["rest", "web", "graphql"]
related: ["auth_logic", "bola", "business_logic"]
---

## Workflow

Build a role/function matrix from observed routes and UI capabilities. Replay a harmless privileged operation under a lower role, compare server decisions, and verify that hidden UI controls are not treated as authorization. Record the exact function and role boundary.
