---
title: Enumeration
phase: enumeration
aliases:
  - enumeration
  - enum
related_skills:
  - active_recon
  - attack_surface_mapping
  - traffic_analysis
---

# Enumeration

## Purpose
Turn scoped discovery leads into a bounded inventory of routes, services, identities, technologies, and input surfaces. Enumeration should increase project knowledge in a measurable way; it must not become an open-ended scan.

## When to use
Use after passive or active reconnaissance when the assessment needs a structured attack-surface inventory or when a hypothesis needs one missing entity or relationship.

## Prerequisites

- Explicit scope, exclusions, redirect policy, and rate limits.
- A target list and a question for each probe.
- A source cursor or output location so repeated runs can resume without duplicating work.
- A decision about whether the operation is passive, low-impact, or an approved active step.

## Workflow

1. Start from known in-scope entities and define the smallest discovery boundary.
2. Normalize hostnames, URLs, paths, ports, services, parameters, and technology names before storing them.
3. Prefer passive supplied evidence, then one-at-a-time validation, then narrowly approved discovery.
4. Record positive, negative, unavailable, and untested results separately.
5. Deduplicate by canonical identity while retaining aliases, source hashes, timestamps, and conflicting observations.
6. Stop when the question is answered or the incremental evidence yield becomes negligible.

## Evidence to collect
Record target, source type, query/wordlist or route set, tool/version, timestamp, response/status fingerprint, resolved address, entity IDs, source pointer, and coverage limitations. Store only sanitized projections in the index.

## Analysis guidance
Do not equate absence from one source with absence from the system. Mark wildcard DNS, shared hosting, CDN, staging, and tenant relationships explicitly. Separate an asset’s existence from its authorization and from its security posture.

## Verification rules
Confirm important routes or services with a second signal or supplied artifact. Recheck redirects and resolved IPs against exclusions. Preserve the original observation when later evidence contradicts it.

## Stop conditions
Stop on scope denial, rate limiting, target drift, unexpected state changes, excessive duplicate results, or a need for a broader wordlist/port range than the plan allows.

## Common failure patterns

- Scanning every discovered host because it appears related.
- Losing the distinction between “not found,” “not tested,” and “blocked.”
- Reusing unbounded wordlists or concurrency settings.
- Storing complete response bodies instead of source references and hashes.
- Using enumeration output as proof of a vulnerability.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE inventory | `query_assessment`, `attack_graph`, `manage_state` | Query, normalize, and track bounded entity inventory. |
| DNS/network | `Resolve-DnsName`, `Test-NetConnection` | Validate one explicitly scoped hostname or service. |
| HTTP discovery | `curl.exe`, `httpx.exe` | Check a plan-approved URL set with conservative limits. |
| Content discovery | `ffuf.exe` | Only with a small approved wordlist, target, and rate limit. |
| Service inventory | `nmap.exe` | Only for declared ports/hosts and a bounded scan profile. |

## Related skills
See `active_recon`, `attack_surface_mapping`, `passive_recon`, `service_analysis`, and `technology_fingerprinting`.
Enumerate one entity class at a time, cluster repeated responses, and preserve representative evidence.

## Evidence to collect
Record entity ID, source reference, route or service, method, status, technology, and confidence.

## Analysis guidance
Normalize routes and parameters without hiding meaningful differences.

## Verification rules
Confirm important inventory entries with a second observation or authoritative source.

## Stop conditions
Stop when the inventory question is resolved or additional probing would expand scope.

## Common failure patterns
Avoid full-corpus prompt loading and repeated equivalent probes.

## Related skills
See `active_recon`, `attack_surface_mapping`, and `traffic_analysis`.
