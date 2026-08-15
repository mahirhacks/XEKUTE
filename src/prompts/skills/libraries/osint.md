---
title: Open-Source Intelligence
phase: recon
aliases:
  - osint
related_skills:
  - passive_recon
  - technology_fingerprinting
---

# Open-Source Intelligence

## Purpose
Collect relevant public information, preserve attribution, and turn it into bounded project observations without converting passive discovery into unauthorized active testing.

## When to use
Use for public certificates, DNS records, documentation, public code, package metadata, archived pages, organization-owned assets, and technology clues when the engagement permits those sources.

## Prerequisites

- Defined organization, product, target, time window, and source restrictions.
- A rule for whether third-party databases, public repositories, search engines, and archives are allowed.
- A method to record source URL/ID, retrieval timestamp, hash, and confidence.
- A plan to redact personal data, secrets, tokens, and irrelevant third-party information.

## Workflow

1. Begin with supplied project evidence and explicit public sources.
2. Search one source class at a time: certificates, DNS, web metadata, documentation, repositories, package registries, or archived content.
3. Corroborate material leads with an independent source before adding them to the attack-surface map.
4. Normalize hostnames, URLs, organizations, technologies, identities, and timestamps; preserve aliases and contradictions.
5. Check every discovered target against current scope before suggesting active validation.

## Evidence to collect
Record source name, source URL or stable ID, query, retrieval time, result summary, source hash where available, target relationship, confidence, and limitation. Store only sanitized summaries and references in LTM; keep raw pages/artifacts in the approved evidence store.

## Analysis guidance
Public availability is not authorization. A certificate, repository string, or archived hostname is a lead. Distinguish current from historical data, ownership from hosting, and a leaked-looking string from a verified secret. Do not attempt to validate credentials discovered during OSINT.

## Verification rules
Corroborate important claims, check timestamps, and verify target ownership through project scope rather than assumptions. If a source conflicts with current project evidence, retain both and mark the conflict.

## Stop conditions
Stop when a source requires prohibited collection, exposes sensitive personal data, suggests credential use, introduces an out-of-scope host, or would require active requests not declared in the plan.

## Common failure patterns

- Treating search-engine indexing as proof of current exposure.
- Copying secrets or personal data into notes.
- Using third-party results to authorize active testing.
- Failing to record source timestamps and query context.
- Expanding research indefinitely after the hypothesis is sufficiently supported.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE knowledge | `query_knowledge`, `query_assessment`, `manage_state` | Select methodology and record bounded OSINT observations. |
| Windows browser | XEKUTE `browser_action` or an approved browser | Review permitted public pages without automated broad crawling. |
| PowerShell DNS | `Resolve-DnsName` | Validate a single DNS observation only when the plan permits active resolution. |
| Certificate lookup | Approved web source or configured MCP mapping | Read public certificate metadata; never treat it as scope authorization. |
| Workspace search | `search_workspace`, `read_file` | Inspect supplied exports, reports, and project notes. |

## Related skills
See `passive_recon`, `technology_fingerprinting`, `active_recon`, `attack_surface_mapping`, and `scope_validation`.

## Evidence to collect
Store source URL or artifact reference, captured summary, timestamp, and confidence.

## Analysis guidance
Treat public claims as leads until corroborated.

## Verification rules
Use independent sources for material conclusions.

## Stop conditions
Stop when access requires credentials or an active action not covered by scope.

## Common failure patterns
Do not copy secrets or personal data into project memory.

## Related skills
See `passive_recon` and `technology_fingerprinting`.
