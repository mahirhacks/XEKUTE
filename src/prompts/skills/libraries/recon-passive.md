---
title: Passive Reconnaissance
phase: recon
aliases:
  - recon-passive
related_skills:
  - passive_recon
  - osint
---

# Passive Reconnaissance

## Purpose
Build an evidence-backed attack-surface picture from public and supplied material before active probing. This hyphenated skill ID remains discoverable for existing workflows and should be used as a passive-only reference.

## When to use
Use during initial discovery, intelligence refresh, and hypothesis preparation when no new request to a target is required.

## Prerequisites

- Confirm the exact reviewed organization/product/target and exclusions.
- Confirm which public sources and third-party databases the engagement permits.
- Prepare source attribution, timestamps, redaction, and evidence retention rules.

## Workflow

1. Review supplied inventories, captures, reports, and project files.
2. Review permitted certificates, DNS records, metadata, robots/sitemap files, public documentation, repositories, and technology signals.
3. Normalize entities and preserve current/historical/conflicting status.
4. Corroborate material observations and map every lead to current scope.
5. Hand an in-scope lead to `active_recon` only after a separate active step is approved.

## Evidence to collect
Record source, query, timestamp, target, source pointer, summary, hash, confidence, and limitation. Never place raw tokens, credentials, personal data, or complete pages into LTM.

## Analysis guidance
Public visibility is not permission. Certificate names and DNS results are leads. Historical and third-party records require explicit freshness and ownership checks.

## Verification rules
Use an independent source for material observations and recheck current scope before active use.

## Stop conditions
Stop on prohibited collection, sensitive data, out-of-scope targets, stale evidence, unavailable sources, or a request that would require active probing.

## Common failure patterns

- Treating a public record as a live, authorized asset.
- Failing to record source time and query.
- Copying secrets into notes.
- Starting active enumeration from a passive result without plan review.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE | `query_assessment`, `query_knowledge`, `read_file`, `search_workspace` | Query project evidence and supplied artifacts. |
| Windows browser | XEKUTE `browser_action` | Manually review permitted public pages. |
| DNS | `Resolve-DnsName` | Only when the plan permits active resolution. |
| HTTP metadata | `curl.exe`, `Invoke-WebRequest` | Prefer existing captures; use a single declared request only. |

## Related skills
See `passive_recon`, `osint`, `recon-active`, `scope_validation`, and `attack_surface_mapping`.

## Evidence to collect
Record source, timestamp, target, raw excerpt, WSTG-INFO mapping, and limitations.

## Analysis guidance
A discovered host is a lead until it matches configured scope.

## Verification rules
Corroborate important passive observations with an independent source.

## Stop conditions
Stop when a source is unavailable, out of scope, or requires an unapproved active request.

## Common failure patterns
Do not treat public visibility as permission to probe.

## Related skills
See `passive_recon`, `osint`, and `active_recon`.
