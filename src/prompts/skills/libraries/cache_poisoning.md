---
id: cache_poisoning
title: Web-cache poisoning
summary: Test cache-key and unkeyed-input behavior with unique harmless markers and isolated cache entries.
category: server-side
level: advanced
signals: ["cache", "vary", "cdn", "header", "query"]
technologies: ["cdn", "proxy", "web"]
related: ["host_header", "request_smuggling", "xss"]
---

## Workflow

Establish cache headers and a control object. Change one observed unkeyed input, use a unique inert marker, and verify whether another clean request receives it. Purge/expire test entries and stop at minimal proof.
