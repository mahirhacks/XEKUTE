---
id: multi_tenant_authorization
title: Multi-tenant authorization
summary: Test tenant isolation across identifiers, headers, hosts, jobs, exports, and shared services.
category: authorization
level: advanced
signals: ["tenant", "organization", "workspace", "account", "host header"]
technologies: ["saas", "rest", "graphql", "web"]
related: ["bola", "advance_bola", "idor", "host_header"]
---

## Workflow

Use two authorized tenants and a non-destructive object. Compare route, body, header, host, token, export, and asynchronous references one at a time. Verify no cross-tenant records, counts, metadata, or side effects are exposed.
