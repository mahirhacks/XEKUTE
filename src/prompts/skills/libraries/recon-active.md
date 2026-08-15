---
title: Active Reconnaissance and Enumeration
phase: recon
aliases:
  - recon-active
related_skills:
  - active_recon
  - enumeration
---

# Active Reconnaissance and Enumeration

## Purpose
Resolve one bounded inventory question with the smallest scoped probe, then turn the result into a durable project observation. This document is the hyphenated compatibility ID for the same phase family as `active_recon`; keep both references distinct and do not silently merge their histories.

## When to use
Use after scope and target readiness are confirmed and passive evidence has identified a question that requires an active request or service check.

## Prerequisites

- An in-scope target, purpose, rate limit, time window, and stop condition.
- A recording destination and source cursor.
- Expected signal, rejecting signal, and a known-good baseline.
- Approval for any broader route, port, host, or identity set.

## Workflow

1. Normalize the target and run the current scope/redirect/resolved-IP checks.
2. Choose one discovery action: live HTTP check, route existence, service exposure, or technology version.
3. Execute once or within the declared small limit; record tool/version, target, timestamp, response fingerprint, and exit outcome.
4. Correlate with project entities and mark observed, unavailable, blocked, or out-of-scope.
5. Stop when the question is answered or when another action would expand the approved set.

## Evidence to collect
Keep target, action, source pointer, status/response projection, resolved address, technology signal, timestamp, hash, and limitations. Raw responses stay in the evidence store.

## Analysis guidance
An active response confirms a behavior at a point in time. It does not prove ownership, vulnerability, or authorization. Preserve historical observations when a later run changes.

## Verification rules
Use a baseline and independent corroboration for material observations. Recheck redirects and resolved IPs before classifying the target.

## Stop conditions
Stop on scope denial, target drift, rate limiting, unexpected mutation, availability impact, or a request for a broader discovery range.

## Common failure patterns

- Treating a discovered live host as automatically in scope.
- Running a full port/path scan for a single inventory question.
- Omitting timestamps and tool versions.
- Storing raw secrets or bodies in the model context.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE | `replay_request`, `query_assessment`, `manage_state` | Run and record one bounded active-recon check. |
| PowerShell | `Resolve-DnsName`, `Test-NetConnection` | Validate a declared DNS/service question. |
| HTTP | `curl.exe`, `httpx.exe` | Check an explicit URL set with conservative limits. |
| Service inventory | `nmap.exe` | Use only for approved hosts/ports and a plan-defined scan profile. |

## Related skills
See `active_recon`, `recon-passive`, `enumeration`, `service_analysis`, and `scope_validation`.

## Evidence to collect
Preserve raw output, exit status, target, timing, and tool version.

## Analysis guidance
Prefer a narrow probe that distinguishes competing inventory hypotheses.

## Verification rules
Recheck the target and any redirect against application scope.

## Stop conditions
Stop when the target or redirect no longer passes scope or the inventory question is resolved.

## Common failure patterns
Do not use bulk probing when a smaller scoped check answers the question.

## Related skills
See `active_recon` and `enumeration`.
