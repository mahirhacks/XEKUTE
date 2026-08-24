---
id: bola
title: Broken object level authorization
summary: Test API object authorization across read, write, delete, and action operations for every identity and tenant boundary.
category: authorization
level: standard
signals: ["api", "object", "tenant", "owner", "resource id"]
technologies: ["rest", "graphql", "grpc", "mobile api"]
related: ["idor", "advance_idor", "bfla", "multi_tenant_authorization"]
---

## Workflow

Build an endpoint/object/identity matrix from observed API traffic. For each operation, compare owner, peer, tenant-peer, administrator, and unauthenticated controls. Change only the object reference, preserve a valid request shape, and check response content and side effects. Include nested JSON, GraphQL variables, path segments, query parameters, headers, and batch arrays when present.

## Evidence and verification

Link each result to both the baseline and negative control. Confirm that a real unauthorized object or state was exposed or changed. A schema declaration, client-side hidden field, or status-code difference is not sufficient evidence.

## Stop conditions

Use disposable objects and stop after minimal reproducible proof or any unexpected cross-tenant impact.
