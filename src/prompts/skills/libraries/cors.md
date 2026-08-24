---
id: cors
title: CORS policy
summary: Test origin reflection, credentialed responses, preflight, and endpoint-specific CORS decisions.
category: platform
level: standard
signals: ["cors", "origin", "preflight", "access-control", "credentials"]
technologies: ["web", "rest", "browser"]
related: ["csrf", "auth_logic"]
---

## Workflow

Compare approved, unapproved, null, and related origins for observed endpoints. Check credential mode, preflight methods/headers, and sensitive response exposure. Do not treat a permissive public non-credentialed resource as a finding.
