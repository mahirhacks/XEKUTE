---
id: host_header
title: Host-header trust
summary: Test whether host-related headers influence links, routing, password resets, caches, or security decisions.
category: server-side
level: advanced
signals: ["host", "forwarded", "reset link", "cache", "origin"]
technologies: ["web", "proxy", "rest"]
related: ["open_redirect", "advance_ssrf", "cache_poisoning"]
---

## Workflow

Compare canonical host and explicitly permitted alternate headers on a disposable route or generated link. Preserve proxy normalization and cache behavior, and require an actual trust-boundary effect.
