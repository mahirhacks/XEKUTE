---
id: idor
title: Insecure direct object reference
summary: Test whether an authenticated principal can read or mutate another principal's object by changing a direct identifier.
category: authorization
level: standard
signals: ["numeric id", "uuid", "object id", "resource id", "owner", "tenant"]
technologies: ["rest", "graphql", "web", "mobile api"]
related: ["bola", "advance_idor", "bfla", "multi_tenant_authorization"]
---

## Purpose

Determine whether object-level authorization is enforced server-side for every read, update, delete, export, and action endpoint.

## Prerequisites

- Two authorized identities with different ownership or tenant relationships.
- A baseline request for an object owned by the active identity.
- A safe object that can be read or changed without causing material impact.

## Intelligence signals

Prioritize routes containing numeric IDs, UUIDs, slugs, filenames, invoice/order/user references, GraphQL node IDs, download tokens, or client-side object maps. A predictable identifier is a lead, not proof.

## Workflow

1. Capture the same operation under owner, peer, administrator, and unauthenticated states when permitted.
2. Change one identifier at a time while keeping method, body, headers, and session constant.
3. Compare status, response shape, ownership fields, side effects, and timing against the baseline and a nonexistent-object control.
4. For writes, use a disposable object and verify the owner, tenant, and audit trail afterward.
5. Test alternate representations, bulk endpoints, exports, nested resources, and HTTP method overrides only when observed in the application.

## Evidence to collect

Record redacted request/response references, identity and tenant labels, object ownership, baseline/control fingerprints, changed identifier, observed behavior, and cleanup result. Do not copy secrets or unrelated records.

## Verification rules

A finding requires reproducible cross-owner or cross-tenant access beyond an intended sharing rule. Distinguish a generic `200` shell from actual unauthorized data or state change. Verify both read and write impact separately.

## Stop conditions

Stop after a minimal proof, on unexpected side effects, when authorization becomes ambiguous, or when the next variant would access sensitive unrelated data.
