---
id: advance_bola
title: Advanced BOLA
summary: Test object authorization across batch, nested, asynchronous, and cross-service API paths.
category: authorization
level: advanced
signals: ["batch", "nested", "async", "tenant", "resolver"]
technologies: ["rest", "graphql", "websocket"]
advance_of: bola
related: ["advance_idor", "bfla", "multi_tenant_authorization"]
---

## Workflow

Extend the BOLA identity/object matrix to batch arrays, nested parents, exports, background jobs, notifications, caches, GraphQL aliases, and alternate services. Change one object reference at a time, use disposable records, and compare owner, peer, tenant, and administrator controls. Require actual unauthorized data or state evidence before promotion.

## Verification rules

Preserve baseline, negative-control, identity, object-owner, and cleanup references. Stop after minimal proof.
