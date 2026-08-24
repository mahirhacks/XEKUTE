---
id: rate_limit_abuse
title: Rate-limit and quota logic
summary: Test whether bounded limits, cooldowns, or quotas can be bypassed through identities, routes, keys, or concurrency.
category: business-logic
level: standard
signals: ["rate limit", "quota", "cooldown", "retry", "otp"]
technologies: ["web", "rest", "api"]
related: ["race_conditions", "auth_logic", "business_logic"]
---

## Workflow

Read configured limits and use a low-volume test identity. Compare route, account, tenant, IP, token, and concurrency dimensions only when observed. Record headers, reset windows, and safe stop thresholds.
