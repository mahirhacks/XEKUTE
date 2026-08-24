---
id: client_storage
title: Client-side storage security
summary: Test tokens, personal data, and authorization state stored in browser storage, caches, URLs, or downloadable artifacts.
category: platform
level: standard
signals: ["localstorage", "sessionstorage", "cache", "token", "url", "indexeddb"]
technologies: ["web", "javascript", "browser"]
related: ["xss", "session_management", "sensitive_data_exposure"]
---

## Workflow

Inventory storage and lifecycle from artifacts and browser evidence. Check sensitivity, origin/tenant boundaries, logout/rotation, cache controls, and URL leakage using disposable accounts. Redact values and distinguish availability from authorization impact.
