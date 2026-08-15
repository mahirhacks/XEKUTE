---
title: Service Analysis
phase: enumeration
aliases:
  - service_analysis
  - service-analysis
related_skills:
  - enumeration
  - technology_fingerprinting
---

# Service Analysis

## Purpose
Understand scoped service exposure, protocol, version, configuration signals, and trust boundaries without treating a banner as a vulnerability conclusion.

## When to use
Use for network/application inventory, technology fingerprinting, attack-surface mapping, and hypothesis preparation.

## Prerequisites

- In-scope host/port/URL and permitted probe intensity.
- A question such as “what service is exposed?” or “does this route use the expected protocol?”
- Baseline evidence and a safe rate limit.
- A plan-approved action for any active version or service probe.

## Workflow

1. Start with supplied traffic, configuration, headers, and passive evidence.
2. Identify service/protocol/port, exposure, transport security, version signal, and source confidence.
3. Corroborate banners with response behavior or an independent source; preserve conflicts.
4. Map service to host, route, technology, identity, and evidence relationships.
5. Record unsupported/hidden/unknown states separately from negative results.

## Evidence to collect
Store canonical host/service/port, protocol, banner projection, response fingerprint, TLS metadata, timestamp, source pointer, tool/version, and limitations. Do not retain private keys, credentials, or full sensitive banners.

## Analysis guidance
Version disclosure is an observation. Assess exposure, reachability, configuration, patch context, and actual security property separately. Shared hosting, proxies, CDNs, and service meshes can make a banner ambiguous.

## Verification rules
Confirm important service identity with two signals or an authoritative supplied record. Check resolved addresses and redirects against scope and exclusions.

## Stop conditions
Stop on unexpected service impact, authentication prompt, rate limit, scope denial, a need for a broader port range, or a request to fingerprint an unapproved host.

## Common failure patterns

- Running a full port scan for a narrow question.
- Treating a product name as a confirmed version.
- Ignoring proxy/CDN effects.
- Storing raw banners containing credentials or internal names.
- Using service discovery as permission for exploitation.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE | `query_assessment`, `replay_request`, `compare_responses` | Correlate bounded service evidence. |
| Windows network | `Test-NetConnection`, `Resolve-DnsName` | Confirm a declared host/service question. |
| Nmap | `nmap.exe` | Narrow, plan-approved service/version inventory. |
| HTTP client | `curl.exe`, `httpx.exe` | Inspect explicitly scoped HTTP/TLS behavior. |
| Wireshark | Wireshark GUI or `tshark.exe` | Read approved captures for protocol metadata. |

## Related skills
See `enumeration`, `technology_fingerprinting`, `active_recon`, `traffic_analysis`, and `scope_validation`.

## Evidence to collect
Preserve service references, banners or sanitized responses, timestamps, and limitations.

## Analysis guidance
Version identification is an observation, not proof of a vulnerability.

## Verification rules
Corroborate material version claims.

## Stop conditions
Stop at scope denial, unexpected impact, or probe limit.

## Common failure patterns
Avoid unbounded service scanning.

## Related skills
See `enumeration` and `technology_fingerprinting`.
