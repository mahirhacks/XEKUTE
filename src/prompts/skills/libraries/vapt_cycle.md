---
title: VAPT Cycle
phase: lifecycle
aliases:
  - vapt_cycle
  - vapt-cycle
related_skills:
  - preflight
  - verification
  - reporting
---

# VAPT Cycle

## Purpose
Coordinate a complete vulnerability-assessment lifecycle from authorization through retest while preserving the distinction between evidence, observations, hypotheses, plans, executions, and verified findings.

## When to use
Use as the top-level workflow reference when the assessment phase is not yet selected, when handing work between modes, or when reviewing coverage and open gaps.

## Prerequisites

- Current project/workspace and assessment scope.
- Authorization, exclusions, redirect/resolved-IP rules, identities, rate limits, dates, and stop contacts.
- Evidence storage/redaction policy and intelligence-index status.
- A clear owner for plan approval and finding review.

## Workflow

1. Complete `preflight` and `scope_validation`.
2. Gather passive evidence and build a bounded attack-surface inventory.
3. Use Hypothesis mode to correlate project knowledge, observations, anomalies, and gaps.
4. Use Plan mode to select assessment methodology, define steps, expected/rejecting signals, allowed tools/targets, and stop conditions.
5. Obtain explicit user approval; approval grants intent, not a scope bypass.
6. Switch to Agent for plan-bound execution or explicitly choose unbound Agent execution.
7. Preserve new evidence, verify or reject hypotheses, document findings, report limitations, and retest remediation.

## Evidence to collect
For every meaningful result record source, timestamp, target, identity class, action, result, evidence reference/hash, mode, plan/run/step ID, and limitation. Store raw evidence separately from compact LTM facts.

## Analysis guidance
Project knowledge answers what happened; assessment knowledge explains how to investigate it. The knowledge graph is rebuildable and lease-scoped; it is not copied into project LTM. The latest active hypothesis is projected into LTM along with supporting/contradicting observations, failures, and gaps.

## Verification rules
Require reproducibility, affected scope, baseline/negative controls, source integrity, and explicit limitations. Never let a new observation silently add an executable target or action to an approved plan.

## Stop conditions
Stop on scope denial, unexpected impact, missing authorization, changed engagement constraint, source corruption, plan drift, or a request that exceeds the approved action set.

## Common failure patterns

- Treating an unverified lead as a finding.
- Treating mode recommendations as automatic mode changes.
- Loading all raw traffic or all skills into context.
- Silently expanding a target set after new evidence appears.
- Deleting negative results, failed approaches, or historical session evidence.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE workflow | `query_knowledge`, `query_assessment`, `manage_plan`, `manage_state` | Select methodology and persist bounded workflow state. |
| XEKUTE assessment | `replay_request`, `browser_action`, `run_test_case`, `verify_finding` | Execute and verify plan-approved actions. |
| Windows workspace | `read_file`, `search_workspace`, `apply_patch` | Inspect or update project files inside scope. |
| Windows HTTP/DNS | `curl.exe`, `Invoke-WebRequest`, `Resolve-DnsName` | Use only for explicit, scope-approved checks. |

## Related skills
See `preflight`, `scope_validation`, `passive_recon`, `enumeration`, `vulnerability_analysis`, `verification`, `reporting`, and `retest`.
