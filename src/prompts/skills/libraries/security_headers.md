---
id: security_headers
title: Security headers and browser policy
summary: Inventory CSP, HSTS, frame, MIME, referrer, permissions, and cookie controls with deployment context.
category: platform
level: standard
signals: ["csp", "hsts", "frame", "cookie", "referrer", "security header"]
technologies: ["web", "browser"]
related: ["xss", "csrf", "cors"]
---

## Workflow

Compare headers across authenticated, static, API, error, redirect, and asset responses. Record coverage, directives, browser context, and practical effect. Do not claim exploitability solely from a missing optional header.
