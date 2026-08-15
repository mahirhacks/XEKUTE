---
title: Technology Fingerprinting
phase: enumeration
aliases:
  - technology_fingerprinting
  - fingerprinting
related_skills:
  - passive_recon
  - service_analysis
---

# Technology Fingerprinting

## Purpose
Identify frameworks, servers, libraries, versions, runtimes, and deployment signals from bounded evidence while stating confidence and uncertainty. Fingerprinting informs a hypothesis; it does not prove a vulnerable version or authorize a test.

## When to use
Use when technology context is needed to interpret a response, map an attack surface, select methodology, or assess whether a supplied version claim is current.

## Prerequisites

- Prefer passive evidence and existing captures.
- A target and permitted request/probe intensity for any active fingerprint.
- A source-attribution, redaction, and version-freshness plan.
- A rule for conflicting signals from CDN, proxy, browser, and origin layers.

## Workflow

1. Collect passive signals: headers, error formats, HTML/script metadata, certificates, package manifests, supplied configuration, and traffic projections.
2. Normalize vendor/product/version names and attach source timestamps.
3. Corroborate with a second signal or an explicit authoritative project record.
4. Record confidence as high, medium, low, conflicting, or unknown, with the reason.
5. Use the result to select a relevant skill; never infer a vulnerability solely from a fingerprint.

## Evidence to collect
Store technology entity, version projection, signal type, source pointer, timestamp, hash, confidence, affected host/route, and limitations. Redact internal paths, secrets, tokens, and personal data.

## Analysis guidance
Distinguish product detection from exact version detection. A framework may be behind a proxy or partially bundled. Mark historical package data and client-controlled headers as weaker evidence.

## Verification rules
Require corroboration for a material version claim and check that the signal belongs to the in-scope target. Recheck after deployment changes and preserve prior observations for timeline analysis.

## Stop conditions
Stop on scope denial, unavailable source, conflicting signals that cannot be resolved safely, or a request to fingerprint a target outside the plan.

## Common failure patterns

- Treating a banner as an exact version.
- Using a technology name to infer exploitability.
- Ignoring proxy/CDN/client layers.
- Copying internal stack traces into LTM.
- Running broad active fingerprints before passive sources are exhausted.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE | `query_assessment`, `query_knowledge`, `compare_responses` | Correlate bounded technology signals. |
| HTTP metadata | `curl.exe`, `httpx.exe` | Inspect one approved response/header set. |
| Nmap | `nmap.exe` | Narrow service/version signal when explicitly approved. |
| Package/project files | `read_file`, `search_workspace` | Inspect supplied manifests and configuration inside the workspace. |
| Wireshark | Wireshark GUI or `tshark.exe` | Identify protocol metadata from approved captures. |

## Related skills
See `passive_recon`, `service_analysis`, `enumeration`, `traffic_analysis`, and `vulnerability_analysis`.

## Evidence to collect
Keep source references and exact signal summaries.

## Analysis guidance
Fingerprinting suggests test ideas; it does not establish a finding.

## Verification rules
Require an independent signal for high-impact conclusions.

## Stop conditions
Stop when further collection would require an unapproved action.

## Common failure patterns
Do not infer exact versions from generic headers alone.

## Related skills
See `passive_recon`, `service_analysis`, and `vulnerability_analysis`.
