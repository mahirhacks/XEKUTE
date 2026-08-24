---
id: graphql
title: GraphQL security testing
summary: Test GraphQL operation authorization, resolver object access, introspection exposure, batching, and input validation.
category: api
level: standard
signals: ["graphql", "resolver", "query", "mutation", "node id", "introspection"]
technologies: ["graphql", "web", "api"]
related: ["bola", "bfla", "sqli", "api_schema_abuse"]
---

## Workflow

Inventory schemas, queries, mutations, fragments, aliases, variables, persisted operations, and error behavior. Compare resolver authorization for owner/peer/tenant identities. Test only observed fields and bounded depth/alias variations, respecting server limits.

## Verification rules

Separate schema exposure from exploitable authorization or data impact. Link every result to the operation, resolver/object, identity, baseline, and negative control.
