---
id: request_smuggling
title: HTTP request smuggling
summary: Review proxy/backend framing and normalization only in an isolated authorized environment.
category: server-side
level: advanced
signals: ["transfer-encoding", "content-length", "proxy", "backend", "http/2"]
technologies: ["http", "proxy", "web"]
related: ["cache_poisoning", "host_header"]
---

## Workflow

Use configuration and safe differential evidence first. Any active desynchronization check requires explicit authorization, low volume, isolated targets, and immediate stop on queue or cross-request anomalies. Never test shared production connections.
