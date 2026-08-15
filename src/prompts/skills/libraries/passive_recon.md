---
title: Passive Reconnaissance
phase: recon
aliases:
  - passive_recon
  - passive-recon
related_skills:
  - osint
  - active_recon
mcp:
  - server: shodan
    tools:
      - name: host_search
        modes: [hypothesis, plan, agent]
        access: read
        target_types: [network]
        target_arguments: [query, host]
  - server: censys
    tools:
      - name: search_hosts
        modes: [hypothesis, plan, agent]
        access: read
        target_types: [network]
        target_arguments: [query]
---

# Passive Reconnaissance

## Purpose
Build an evidence-backed attack-surface picture from public and supplied material before active probing. Passive recon answers “what may exist?” while leaving authorization and active validation to scope and plan controls.

## When to use
Use during initial discovery, intelligence refresh, or hypothesis preparation when public sources, supplied traffic, certificates, metadata, or project files can answer the question without sending new target requests.

## Prerequisites

- Completed `preflight` and confirmed permitted passive source classes.
- Defined organization/product/target identifiers and time window.
- A source-attribution and redaction process.
- The current scope and exclusion list for classifying discovered hosts and URLs.

## Workflow

1. Review supplied project records before external sources.
2. Collect permitted certificates and certificate names, DNS data, public documentation, robots/sitemap metadata, response headers already captured, repository/package clues, and technology signals.
3. Normalize names and URLs, preserve source timestamps, and deduplicate without erasing conflicting observations.
4. Corroborate material claims and mark current, historical, third-party, unresolved, or out-of-scope status.
5. Create an active-recon question only when a lead is in scope and the next request is explicitly approved.

## Evidence to collect
Record source, query, retrieval timestamp, target, source pointer, response/metadata summary, hash where possible, confidence, and limitation. Keep raw public pages and captures in the evidence store; LTM receives compact facts and references only.

## Analysis guidance
A discovered host is a lead until it matches configured scope. Public visibility, certificate inclusion, DNS resolution, or repository ownership does not itself permit probing. Separate organizational attribution from technical control and current exposure from historical evidence.

## Verification rules
Corroborate important observations with an independent permitted source. Check freshness and resolve redirects/hosts through current scope before active use.

## Stop conditions
Stop when a source is unavailable, prohibited, sensitive, out of scope, stale beyond the engagement window, or requires an unapproved active request. Preserve the gap instead of substituting an assumption.

## Common failure patterns

- Treating public visibility as permission to probe.
- Copying personal data or secrets into the graph or LTM.
- Treating certificate names or DNS records as confirmed live assets.
- Mixing historical and current records without timestamps.
- Launching an active scan from a passive result without plan review.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE passive workflow | `query_assessment`, `query_knowledge`, `manage_state` | Query project sources and record sanitized observations. |
| XEKUTE workspace | `read_file`, `search_workspace` | Inspect supplied inventories, captures, and reports. |
| Windows browser | XEKUTE `browser_action` | Review explicitly permitted public pages manually. |
| DNS metadata | `Resolve-DnsName` | Only when active DNS resolution is allowed by scope. |
| HTTP metadata | `curl.exe` or `Invoke-WebRequest` | Only for a declared single request; prefer existing captures. |

The existing `shodan`/`censys` metadata mappings are optional knowledge integrations; they do not authorize network activity and only activate when configured and allowed for the current mode.

## Related skills
See `osint`, `active_recon`, `recon-passive`, `scope_validation`, and `enumeration`.
