---
id: advance_idor
title: Advanced IDOR and authorization bypass
summary: Extend object-authorization testing across indirect references, alternate channels, bulk operations, and state transitions.
category: authorization
level: advanced
signals: ["idor", "object id", "bulk", "export", "nested resource", "alternate endpoint"]
technologies: ["rest", "graphql", "websocket", "mobile api"]
advance_of: idor
related: ["bola", "bfla", "multi_tenant_authorization", "business_logic"]
---

## Purpose

Test authorization consistency when the same object is reachable through multiple identifiers, services, channels, or workflow states.

## Prerequisites

Complete the standard IDOR baseline first. Identify object aliases, parent/child relationships, asynchronous jobs, exports, caches, GraphQL global IDs, signed references, and service boundaries from evidence.

## Techniques

- Compare raw IDs, encoded IDs, UUID casing, alternate slugs, array positions, and nested parent identifiers.
- Re-run an authorized operation through list, detail, search, export, download, notification, webhook, and background-job endpoints.
- Compare authorization decisions before and after ownership transfer, deletion, invitation, approval, or tenant switching.
- Test batch requests for mixed authorized/unauthorized objects and partial-failure leaks.
- Verify that edge services, caches, and asynchronous workers repeat the same policy decision.

## Verification rules

Prove the server accepted an object reference that the active principal is not permitted to use, and identify the policy boundary that failed. Do not infer bypass from an encoded value or a different error message alone.
