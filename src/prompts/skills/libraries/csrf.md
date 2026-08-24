---
id: csrf
title: Cross-site request forgery
summary: Test whether a state-changing browser request can be triggered without the intended origin proof or user interaction.
category: authentication
level: standard
signals: ["cookie", "state change", "origin", "referer", "csrf token", "samesite"]
technologies: ["web", "rest", "browser"]
related: ["auth_logic", "xss", "cors", "business_logic"]
---

## Workflow

Inventory state-changing methods and browser credential behavior. Compare same-site baseline, cross-site origin/referer variants, missing/invalid token, content-type alternatives, and SameSite/cookie settings. Use a disposable account and harmless reversible state change.

## Verification rules

Require proof that a cross-site context can cause the authorized state change without the required anti-CSRF property. A missing token on a non-cookie API or a GET-only read is not sufficient.
