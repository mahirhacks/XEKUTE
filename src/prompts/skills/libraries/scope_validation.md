---
title: Scope Validation
phase: preflight
aliases:
  - scope_validation
  - scope-validation
related_skills:
  - preflight
---

# Scope Validation

## Purpose
Resolve whether a workspace path, host, URL, redirect, resolved address, browser target, or delegated resource is explicitly authorized. Scope validation is a runtime decision and cannot be replaced by a prompt, skill, authority selector, map entry, or MCP mapping.

## When to use
Use before every action that touches a filesystem, process, browser, network, redirect, or resolved address, and again after a target changes.

## Prerequisites

- Current project profile and workspace root.
- Explicit inclusions, exclusions, redirect policy, reserved-address policy, and assessment time window.
- Canonical target normalization and DNS resolution where required.
- A structured result path containing code, reason, and user-remediation text.

## Workflow

1. Normalize path, host, URL, port, and scheme without losing the original target.
2. Check workspace containment for file/process arguments.
3. For network targets, evaluate explicit host/URL/path inclusion, exclusions, resolved addresses, reserved ranges, and redirect inheritance.
4. Apply exclusions after inclusions; a denial remains a denial even when another rule includes the broader host.
5. Return `ALLOW` or a structured denial such as `SCOPE_NOT_CONFIGURED`, `TARGET_OUT_OF_SCOPE`, `PATH_OUTSIDE_WORKSPACE`, or `RESOLVED_ADDRESS_EXCLUDED`.
6. Record the decision reference and never treat a previous decision as permission for a materially different target.

## Evidence to collect
Record normalized target, project/profile reference, inclusion/exclusion rule IDs, resolved addresses, redirect chain, decision code, reason, timestamp, and resolver/source version. Do not store credentials or connection secrets.

## Analysis guidance
A bare host covers that host and its paths, not subdomains. Subdomains need explicit entries or wildcard scope. Redirects inherit authorization only after every redirect URL/path/target/IP check passes. Exclusions always override inclusions.

## Verification rules
Test exact host, path, wildcard-subdomain, redirect, DNS, IP-range, reserved-address, and exclusion precedence. Recheck browser follow-up actions against the last approved target and final URL.

## Stop conditions
Stop on missing scope, unresolved DNS, redirect outside scope, reserved/excluded address, workspace escape, profile mutation, or ambiguous target ownership.

## Common failure patterns

- Using organizational ownership as scope.
- Checking only the first URL and not redirects or resolved IPs.
- Treating a browser session as a permanent authorization.
- Allowing a path traversal or absolute path outside the workspace.
- Hiding a denial from the model instead of returning structured remediation.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE policy | Scope evaluation in the canonical dispatcher | Enforce workspace, network, redirect, and plan constraints. |
| Windows paths | `Resolve-Path`, `Get-Location` | Normalize and verify local workspace containment. |
| Windows DNS | `Resolve-DnsName` | Resolve permitted hostnames before network execution. |
| Windows network | `Test-NetConnection` | Validate a single permitted connectivity question. |

## Related skills
See `preflight`, `active_recon`, `recon-active`, `authentication_testing`, and `vapt_cycle`.

## Evidence to collect
Record the exact target, decision code, reason, and remediation text.

## Analysis guidance
Exclusions override inclusions; a bare host does not authorize subdomains unless configured.

## Verification rules
Redirects and resolved IP addresses require independent rechecks.

## Stop conditions
Stop on `SCOPE_NOT_CONFIGURED`, explicit exclusion, reserved address, or unresolved target.

## Common failure patterns
Do not use a prior successful target decision as authorization for a different target.

## Related skills
See `preflight` and `active_recon`.
