---
id: graphql-audit
title: "GraphQL Security Audit"
description: "Structured GraphQL endpoint review for schema exposure, authorization gaps, resolver abuse, and operational limits when the target serves GraphQL over HTTP or WebSocket."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# GraphQL Security Audit

## What the skill is

A judgment-first playbook for reviewing GraphQL APIs where a single route accepts client-defined queries and mutations. It treats the schema (or partial schema recovered without introspection) as the map of business logic, then tests whether resolvers enforce identity, limits, and safe handling of arguments—without treating “knowing the schema” as the final finding.

## When to use

Load this skill when recon or traffic shows a GraphQL endpoint (common paths include `/graphql`, `/api/graphql`, or vendor-specific variants), when mobile or SPA traffic posts JSON bodies with `query`/`operationName`/`variables`, or when subscriptions use a GraphQL-over-WebSocket protocol. Skip it when the surface is REST-only with no GraphQL transport, or when the endpoint is clearly deprecated and unreachable.

## How to use

Work in phases; exit early only when each phase shows consistent hardening with no alternate code paths worth checking.

1. **Scope and session** — Confirm in-scope host, required auth (cookie, bearer, custom headers), and whether staging differs from production. Capture baseline traffic from a normal user session before changing queries.

2. **Discovery and fingerprint** — Identify engine and deployment patterns (gateway vs monolith, federation hints). Fingerprinting informs which misconfigurations are common for that stack and whether downstream services deserve separate review.

3. **Schema visibility** — Determine whether full introspection works, partial type introspection works, or only error-driven hints reveal names. Record what was recovered: types, mutations, sensitive field names, subscription channels, deprecated fields.

4. **Schema-driven prioritization** — From the recovered map, rank objects and fields by impact: cross-user identifiers, admin-only fields, credential or payment adjacent data, destructive mutations, and real-time subscriptions. Deprecated and “internal” names often lag authorization checks.

5. **Transport and policy limits** — Assess batching, aliasing, GET vs POST, depth/complexity controls, and rate limiting as they apply to GraphQL specifically (many requests in one HTTP call, many resolver executions in one document). Note whether limits apply per HTTP request, per operation, or per field.

6. **Authorization** — Test object-level access (queries/mutations keyed by ID), field-level exposure on objects the caller legitimately receives, unauthenticated access to queries and mutations, and horizontal-to-vertical escalation via role or profile mutations. Use separate identities when the program allows.

7. **Argument and resolver trust** — Reason about string and structured arguments bound into backend stores or templates (SQL, document stores, search, rendering). Failures live in resolver code, not in GraphQL syntax itself.

8. **Subscriptions** — When WebSocket subscriptions exist, test whether event streams are scoped to the authenticated subject or leak cross-tenant or cross-user updates.

9. **Synthesis and chaining** — Separate informational issues (schema disclosure) from exploitable access-control or abuse outcomes. Chain only what you can demonstrate under program rules.

10. **Stop conditions** — End the audit when the endpoint is inactive, every path returns undifferentiated denial with no leak surface, aggressive rate limits block meaningful testing, or the node is only an opaque gateway with no actionable resolvers on that host.

## Mental model

GraphQL concentrates attack surface into one door: the client chooses shape and depth. Introspection and field suggestions are reconnaissance accelerators, not vulnerabilities by themselves—the bug is missing checks on resolvers. Aliasing and batching multiply work per HTTP request, which affects brute-force, denial-of-service, and rate-limit bypass reasoning. Authorization must be enforced per field and per object, not assumed from a single middleware on the route. Blocklists on introspection keywords often miss alternate syntax, GET handlers, or subscription stacks running different middleware.

## Tools

| Tool | Job |
| --- | --- |
| `graphql_audit.sh` | Orchestrates a multi-phase automated sweep with auth, proxy, and artifact output |
| graphw00f | Fingerprints GraphQL engine and implementation traits |
| clairvoyance | Reconstructs type and field names when introspection is disabled |
| graphql-cop | Runs a checklist of common GraphQL misconfigurations |
| gqlmap | Probes argument handling for injection classes in resolvers |
| InQL (Burp extension) | Imports schema into Burp for manual query construction and access tests |
| graphql-voyager | Visualizes schema for human prioritization |
| wscat | Exercises subscription channels over WebSocket when HTTP tools are insufficient |

## Expected output if success

A structured finding set under your program’s evidence layout: schema artifacts (when policy allows storing them), fingerprint notes, a prioritized list of sensitive types/fields/mutations, confirmed issues with clear impact (IDOR, broken auth, injection, subscription leakage, abusive batching tied to a business outcome), chain notes where multiple weaknesses combine, and explicit “tested but secure” areas to avoid duplicate work. Each reported item should state endpoint, operation shape at a high level, identities used, and why the behavior violates expected authorization or availability—not merely that introspection returned data.

## Expected output if not success

A concise stop report: endpoint status (404, generic errors, uniform unauthorized responses), which phases were blocked (rate limit, WAF, empty schema surface), and recommended pivot (e.g., federated subgraphs, alternate API version, mobile-only host). No fabricated severity from schema hints alone.

## Verification method

Re-run the minimal query or mutation that demonstrates the issue with a fresh session and a second identity where applicable. Confirm the sensitive data or privileged action is not explained by public design docs or intended public fields. For limit-related issues, show measurable behavior change (timing, error volume, lockout bypass) tied to GraphQL-specific batching or depth—not generic HTTP flooding. Validate scope on the exact host and operation reported. Before submission, cross-check with the report-writing skill: proved impact, reproducible steps, severity aligned with demonstrated harm.
