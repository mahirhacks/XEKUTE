---
title: Active Reconnaissance
phase: recon
aliases:
  - active_recon
  - active-recon
related_skills:
  - passive_recon
  - enumeration
---

# Active Reconnaissance

## Purpose
Resolve a specific, authorized inventory question with the smallest useful active probe. Active recon turns a passive lead into a verified asset, route, service, or technology observation; it does not authorize a broader scan by itself.

## When to use
Use after `preflight`, `scope_validation`, and passive discovery have produced an in-scope target and a concrete question. Prefer one target and one hypothesis per run. If the question is not clear enough to define an expected result and a stop condition, return to `hypothesis` mode.

## Prerequisites

- An exact host, URL, path, service, or project evidence reference.
- Confirmed inclusion, exclusions, redirect policy, rate limit, test window, and identity requirements.
- A baseline and an expected signal, such as an HTTP response, DNS record, open service, or version indicator.
- A safe output location inside the workspace; never write raw credentials or tokens into the project memory.

## Workflow

1. Normalize the target and run the XEKUTE scope check before the first request.
2. Select the least intensive probe that can answer the question: request a known URL, resolve a hostname, inspect a known service, or compare a single response.
3. Record the exact target, timestamp, method, status, response fingerprint, tool version, rate settings, and exit outcome.
4. Correlate the result with existing entities. Mark a target as `observed`, `unreachable`, `redirected`, `out_of_scope`, or `unresolved`; do not infer vulnerability from exposure alone.
5. Stop when the question is answered, the probe becomes repetitive, scope fails, or the expected safety boundary is reached.

## Evidence to collect
Store a source pointer and sanitized projection for each result: target, request reference, response/status, resolved addresses, technology signal, timestamp, and limitations. Preserve full artifacts in the project evidence store when permitted; place only bounded summaries and hashes in model context and LTM.

## Analysis guidance
Separate discovery from interpretation. A live port is an observation, not proof of a vulnerable service. A version banner is a lead until corroborated. Compare passive and active sources, record conflicts, and state confidence and missing evidence explicitly.

## Verification rules
Repeat only the minimum request needed to confirm a material observation. Use a second independent signal where practical, such as a response header plus a version page. Verify redirects, resolved IPs, and paths against exclusions on every hop.

## Stop conditions
Stop on any structured scope denial, unexpected destructive behavior, authentication lockout risk, rate-limit response, target drift, or missing authorization. Do not broaden ports, paths, hosts, or identities without a new approved plan step.

## Common failure patterns

- Treating a discovered hostname as authorized merely because it belongs to a known organization.
- Running a large wordlist when a single route check would answer the question.
- Losing the original target after a redirect or DNS change.
- Storing cookies, API keys, or full sensitive responses in a summary.
- Reporting a scanner or banner result as a verified finding.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE | `query_assessment`, `query_knowledge`, `replay_request`, `browser_action` | Prefer bounded, evidence-linked discovery through the active mode surface. |
| PowerShell | `Resolve-DnsName`, `Test-NetConnection` | Confirm DNS and a single permitted TCP service question. |
| Windows HTTP client | `curl.exe`, `Invoke-WebRequest` | Request one explicitly scoped URL and capture a sanitized baseline. |
| Nmap | `nmap.exe` | Only for an approved, narrow service-inventory step with explicit rate and target limits. |
| Project files | `read_file`, `search_workspace`, `inspect_environment` | Inspect supplied inventories, logs, and local configuration without leaving the workspace. |

Use only software installed on the Windows host and only when the active plan permits it. A table entry is guidance, not an automatic tool activation.

## Related skills
See `passive_recon`, `scope_validation`, `enumeration`, `service_analysis`, and `technology_fingerprinting`.

## Evidence to collect
Record target, request or probe, response summary, timing, status, and source reference.

## Analysis guidance
Separate discovered leads from verified assets.

## Verification rules
Recheck redirects and resolved targets through the active scope policy.

## Stop conditions
Stop when the target or redirect leaves configured scope or unexpected impact appears.

## Common failure patterns
Do not broaden a scan because the first probe returned little information.

## Related skills
See `passive_recon`, `enumeration`, and `traffic_analysis`.
