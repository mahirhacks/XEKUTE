---
title: Verification, Reporting, and Retest
phase: reporting
aliases:
  - post-vuln-probing
related_skills:
  - verification
  - finding_documentation
  - reporting
  - retest
---

# Verification, Reporting, and Retest

## Purpose
Close the loop after a probe reaches a terminal outcome: classify the behavior, preserve evidence, document the finding or limitation, and define a future retest without confusing an observation with a verified conclusion.

## When to use
Use after a hypothesis is verified, rejected, inconclusive, blocked, or stopped. It is the transition point between execution evidence and durable project knowledge.

## Prerequisites

- Evidence IDs and source hashes with affected scope.
- Expected and rejecting signals, identity/target context, and cleanup status.
- A confidence statement, limitation, and next action or retest condition.
- Redaction of credentials, tokens, personal data, and unnecessary raw bodies.

## Workflow

1. Review the baseline, variant, control, and tool/run metadata.
2. Classify the result as verified, rejected, inconclusive, blocked, or needs-plan-revision.
3. For verified behavior, create a structured finding and link it to hypothesis, plan step, run, observations, and evidence.
4. Record remediation expectation, retest predicate, and residual uncertainty.
5. Update project memory with the outcome and important evidence references; never copy a complete transcript or skill packet.

## Evidence to collect
Keep minimal reproduction references, expected/rejecting signals, target/identity class, before/after summaries, source hashes, timestamps, cleanup, and limitations. Preserve failed approaches and negative results when they change future decisions.

## Analysis guidance
A rejected hypothesis is valuable project knowledge. An inconclusive result must identify the exact gap. A verified finding must distinguish demonstrated impact from plausible risk and must not rely solely on scanner output or a version string.

## Verification rules
Require reproducibility or an explicit reason why it cannot be repeated. Use an independent control where practical. Ensure the conclusion survives scope, identity, redirect, cache, and source-integrity checks.

## Stop conditions
Stop when classification is stable, evidence is safely stored, and the next step is explicit. Do not begin a new test from a reporting task without a new plan step.

## Common failure patterns

- Deleting rejected or failed evidence.
- Updating a finding without preserving its prior status and evidence.
- Reporting a tool alert as a conclusion.
- Omitting the retest predicate.
- Carrying secrets into durable memory.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE closure | `verify_finding`, `store_finding`, `manage_state` | Record status, evidence links, and next actions. |
| XEKUTE retrieval | `expand_evidence`, `query_assessment` | Inspect bounded evidence and prior outcomes. |
| Windows hashing | `Get-FileHash` | Check source integrity before final classification. |
| XEKUTE editor | Native workspace editor | Draft redacted finding and retest records. |

## Related skills
See `verification`, `finding_documentation`, `reporting`, and `retest`.
Check every claim against its evidence, reproduce material behavior, record rejected and inconclusive hypotheses, map coverage, and document exact retest steps.

## Evidence to collect
Preserve proof, negative controls, coverage references, remediation, and retest evidence.

## Analysis guidance
Missing coverage is a limitation rather than a claim.

## Verification rules
Only evidence-backed, reproducible behavior is a verified finding.

## Stop conditions
Stop when the status and limitations are explicit.

## Common failure patterns
Do not merge inferred impact into an observed result.

## Related skills
See `verification`, `finding_documentation`, `reporting`, and `retest`.
