---
title: Attack Surface Mapping
phase: enumeration
aliases:
  - attack_surface_mapping
  - attack-surface
related_skills:
  - enumeration
  - technology_fingerprinting
---

# Attack Surface Mapping

## Purpose
Build a traceable model of the engagement surface: assets, hosts, services, routes, identities, technologies, findings, and the evidence that connects them. The map is a projection of project knowledge, not a permission list and not a replacement for runtime scope checks.

## When to use
Use after preflight and whenever discovery produces multiple observations that need correlation. It is especially useful before hypothesis creation, plan drafting, coverage review, and retest selection.

## Prerequisites

- A configured project workspace and current assessment scope.
- The intelligence index state and its source cursor status.
- Sanitized evidence references with timestamps and source hashes.
- A clear distinction between observed entities, inferred relationships, and unresolved leads.

## Workflow

1. Query the bounded project intelligence projection before reading raw artifacts.
2. Normalize hostnames, URLs, route templates, ports, service names, technology names, identities, and evidence IDs.
3. Merge duplicate entities only when the normalized key and source evidence support the merge; preserve aliases and conflicting values.
4. Add relationships such as `hosts`, `serves`, `exposes`, `uses`, `accessed_by`, `observed_in`, `supports`, and `contradicts`.
5. Attach confidence, first-seen/last-seen timestamps, source references, and unresolved questions to every nontrivial relationship.
6. Record coverage gaps separately from negative findings. A missing observation is not proof that an entity is absent.

## Evidence to collect
For each mapped entity, retain a stable ID, canonical value, source references, confidence, timestamps, and a short sanitized projection. For each relationship, retain relation type, source and destination IDs, evidence IDs, provenance, and whether it is observed or inferred.

## Analysis guidance
Keep project knowledge separate from reusable assessment methodology. A service-to-route relationship may support a hypothesis, but it does not make a test authorized. Prefer one-hop bounded traversal for chat context and query deeper relationships through `query_assessment` with pagination.

## Verification rules
Validate important links against at least one primary artifact and, when practical, an independent source. Recheck stale mappings before planning active work. When identifiers conflict, retain both values and create an explicit ambiguity rather than silently overwriting data.

## Stop conditions
Stop a mapping operation when the index is rebuilding, a source hash changed, a relationship cannot be supported, or a requested traversal exceeds its bounded result limit. Defer a full rebuild rather than blocking the chat.

## Common failure patterns

- Treating the map as a complete inventory when source cursors are incomplete.
- Collapsing different tenants, ports, or identities into one entity.
- Converting a technology guess into a confirmed version.
- Hiding stale or contradictory evidence to make the graph look clean.
- Using map membership as an authority decision.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE intelligence | `query_assessment`, `attack_graph`, `manage_state` | Query and update bounded project relationships and coverage state. |
| XEKUTE workspace | `read_file`, `search_workspace`, `inspect_environment` | Inspect supplied inventories and local project metadata. |
| PowerShell | `Resolve-DnsName`, `Get-NetTCPConnection` | Corroborate a narrow host/service observation when explicitly permitted. |
| Wireshark | `tshark.exe` or Wireshark GUI | Read an approved capture and extract bounded protocol metadata. |
| Windows hashing | `Get-FileHash` | Verify that an artifact still matches its recorded source hash. |

These tools produce evidence for the map; they do not bypass scope or plan constraints.

## Related skills
See `enumeration`, `service_analysis`, `technology_fingerprinting`, `traffic_analysis`, and `vulnerability_analysis`.

## Evidence to collect
Keep stable entity and evidence references for every relationship.

## Analysis guidance
Distinguish observed relationships from inferred relationships.

## Verification rules
Do not promote an inferred edge to a finding without supporting evidence.

## Stop conditions
Stop traversal at the bounded retrieval limit or when evidence is insufficient.

## Common failure patterns
Do not load the complete graph into the model context.

## Related skills
See `enumeration`, `traffic_analysis`, and `verification`.
