---
title: Traffic Analysis
phase: traffic_analysis
aliases:
  - traffic_analysis
  - traffic-analysis
related_skills:
  - enumeration
  - identity_session_analysis
  - input_validation
---

# Traffic Analysis

## Purpose
Extract bounded, sanitized observations from captured requests, responses, browser events, replay results, and response clusters. Traffic analysis turns raw exchanges into project intelligence without treating the full capture as prompt context.

## When to use
Use when traffic, replay results, or response clusters need correlation by route, identity, tenant, status, parameter, technology, or state transition.

## Prerequisites

- Confirm the traffic belongs to the current project and authorized assessment.
- Source hash, capture timestamp, identity label, and redaction policy.
- A defined analysis question and bounded pagination/character limits.
- Secure artifact storage for raw captures; only sanitized projections may reach the model.

## Workflow

1. Ingest or query capture metadata without loading the complete corpus into memory.
2. Normalize routes, parameters, headers of interest, identities, session states, status classes, response structures, and timestamps.
3. Cluster repeated responses while preserving counts and representative evidence references.
4. Compare matched requests across identities, inputs, routes, and states with one variable changed.
5. Record observations, anomalies, negative results, and evidence relationships; retain raw pointers and hashes.
6. Use `expand_evidence` only for bounded, source-verified details needed to answer the current question.

## Evidence to collect
Record request/response IDs, source hash, identity class, route template, method, status, selected headers, body structure summary, timing bucket, meaningful difference, and limitations. Redact authorization, cookies, API keys, personal data, and sensitive bodies.

## Analysis guidance
Separate observed differences from hypotheses about cause. A response cluster is a similarity aid, not proof of equivalence. Consider cache, retry, CDN, content negotiation, and session state before interpreting a difference.

## Verification rules
Use controlled comparisons, positive/negative controls, source-hash verification, and representative evidence. Preserve repeated counts and outliers rather than flattening them into one summary.

## Stop conditions
Stop when additional traffic is redundant, source integrity fails, redaction cannot be guaranteed, the target becomes out of scope, or the requested expansion exceeds bounded evidence limits.

## Common failure patterns

- Loading a complete capture into the prompt or process memory.
- Placing raw credentials, cookies, or complete sensitive bodies in LTM.
- Treating a single outlier as a finding.
- Losing identity/session context while clustering.
- Expanding from an observed request into unapproved replay actions.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE traffic | `ingest_traffic`, `query_assessment`, `expand_evidence` | Ingest and inspect bounded projections. |
| XEKUTE comparison | `compare_responses`, `replay_request` | Compare or reproduce one approved exchange. |
| Burp Suite / ZAP | Windows desktop applications | Review authorized captures with redaction. |
| Wireshark | Wireshark GUI or `tshark.exe` | Extract bounded protocol metadata from approved PCAP files. |
| Windows files | `Get-FileHash`, `Get-Content` | Verify source artifacts without Unix-only commands. |

## Related skills
See `enumeration`, `identity_session_analysis`, `authorization_testing`, `input_validation`, and `attack_surface_mapping`.
