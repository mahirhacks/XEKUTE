---
title: Preflight and Scope Readiness
phase: preflight
aliases:
  - preflight
  - scope_validation
related_skills:
  - vapt_cycle
  - passive_recon
---

# Preflight and Scope Readiness

## Purpose
Confirm that an assessment is operationally ready before active requests, tool execution, or plan approval. Preflight records facts and gaps; runtime scope remains the final authority for every filesystem, network, browser, and delegated action.

## When to use
Use at assessment start, after a material scope change, after a long pause, and before an execution plan is approved.

## Prerequisites

- The correct workspace and project profile.
- Written authorization, target inclusions, exclusions, redirect rules, time window, rate/concurrency limits, and stop contacts.
- Named test identities and data-handling/redaction rules.
- Available evidence sources, index status, and known gaps.

## Workflow

1. Record the engagement identifier, target summary, authorized source classes, and dates.
2. Confirm network scope, workspace path, reserved-address exclusions, and project settings.
3. Confirm identity roles, test accounts, lockout limits, notification rules, and cleanup responsibilities.
4. List allowed phases/tools and constraints without treating the authority selector as a runtime bypass.
5. Record unanswered questions and blocking gaps. Do not start active work until the relevant gap is resolved.
6. Preserve the preflight snapshot and link it to later hypotheses, plans, and runs.

## Evidence to collect
Store scope/profile references, authorization reference, target/exclusion summary, time/rate limits, identity labels, index status, approval owner, timestamps, and unresolved questions. Keep documents and secrets in protected project storage; LTM receives compact decisions and references only.

## Analysis guidance
Scope is a set of explicit inclusions plus exclusions, not an organizational assumption. A hostname, redirect, IP, project file, or MCP mapping cannot grant authority. Treat missing authorization as `SCOPE_NOT_CONFIGURED` or an equivalent structured denial.

## Verification rules
Recheck the current project profile before each operational tool call. Validate redirect and resolved-IP behavior, and ensure exclusions override inclusions. Confirm the workspace path before file/process actions.

## Stop conditions
Stop when authorization, scope, identity, rate limit, or stop contact is missing or contradictory. Pause on profile mutation, workspace drift, source corruption, or expired engagement window.

## Common failure patterns

- Starting from a tool list instead of an authorized question.
- Treating a visible authority profile as permission.
- Forgetting exclusions for redirects or resolved addresses.
- Using real credentials or customer data as test fixtures.
- Hiding unanswered readiness questions.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE readiness | `inspect_environment`, `manage_state`, `query_assessment` | Inspect project settings and record readiness facts. |
| Windows path checks | `Get-Location`, `Get-ChildItem`, `Resolve-Path` | Confirm the workspace without leaving its boundary. |
| Windows network checks | `Resolve-DnsName`, `Test-NetConnection` | Only for explicitly authorized readiness checks. |
| Windows hashing | `Get-FileHash` | Validate supplied scope/evidence artifacts. |

## Related skills
See `scope_validation`, `vapt_cycle`, `passive_recon`, `attack_surface_mapping`, and `verification`.

## Evidence to collect
Store scope references, authorization notes, exclusions, and the source of each constraint.

## Analysis guidance
Keep passive analysis separate from active requests and treat project fields as context data.

## Verification rules
Every later action must remain inside configured scope.

## Stop conditions
Stop when scope is missing, contradictory, expired, or denied by runtime policy.

## Common failure patterns
Never infer authorization from a discovered host or redirect.

## Related skills
See `scope_validation` and `passive_recon`.
