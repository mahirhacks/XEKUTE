---
title: Finding Documentation
phase: reporting
aliases:
  - finding_documentation
  - finding-docs
related_skills:
  - verification
  - reporting
---

# Finding Documentation

## Purpose
Convert verified evidence into a clear, reproducible, bounded finding record that another reviewer can understand without access to secrets or an unlimited transcript.

## When to use
Use after `verification` has classified the result as verified and before interim or final reporting. Use the same structure for a verified negative or inconclusive result when it materially affects coverage.

## Prerequisites

- Stable evidence IDs and source hashes.
- Affected asset, route/function, identity class, and scope reference.
- Reproduction steps, expected and rejecting signals, impact, confidence, limitations, and cleanup status.
- A remediation owner or recommended control where one is known.

## Workflow

1. Write a short title that names the security property and affected surface.
2. State the finding in one sentence: actor, action, boundary, and observed consequence.
3. List affected scope and prerequisites without including credentials or personal data.
4. Give minimal reproduction steps with request/evidence references and expected/rejecting signals.
5. Explain demonstrated impact separately from plausible impact, and identify the evidence that supports each claim.
6. Add remediation guidance, residual risk, limitations, confidence, and retest criteria.
7. Link the finding to its hypothesis, plan step, run, observations, and evidence.

## Evidence to collect
Use source pointers, hashes, sanitized excerpts, timestamps, identity labels, and before/after projections. Keep raw artifacts in the evidence store and provide a redacted reviewer view. Record missing evidence explicitly rather than filling gaps with assumptions.

## Analysis guidance
Avoid severity inflation. Explain exploit prerequisites, affected population, impact dimensions, and whether exploitability was demonstrated. Keep observed facts, interpretation, and recommendation in separate fields.

## Verification rules
Do not create a verified finding from a scanner title, version guess, error message, or unvalidated hypothesis. Require reproducibility or explain why a deterministic proof is impossible. A finding must include a negative-control outcome or an explicit reason it was unavailable.

## Stop conditions
Stop documentation when evidence is insufficient, scope is unresolved, secrets cannot be safely redacted, or the finding would require a new test. Return it to `vulnerability_analysis` or `verification` with a concrete evidence gap.

## Common failure patterns

- Copying raw cookies, tokens, personal data, or complete database responses into a report.
- Mixing several root causes into one untestable claim.
- Omitting affected scope and limitations.
- Describing a possible impact as demonstrated impact.
- Writing remediation without a measurable retest condition.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE finding workflow | `verify_finding`, `store_finding`, `manage_state` | Persist structured, evidence-linked finding status. |
| XEKUTE evidence | `expand_evidence`, `query_assessment` | Inspect bounded source projections and provenance. |
| Windows hashing | `Get-FileHash` | Confirm that report attachments match recorded artifacts. |
| Windows editor | XEKUTE editor or any approved Markdown editor | Draft reports without exposing secrets to unrelated applications. |

## Related skills
See `verification`, `reporting`, `retest`, `vulnerability_analysis`, and `post-vuln-probing`.

## Evidence to collect
Reference canonical evidence rather than copying secrets or large artifacts.

## Analysis guidance
Separate observed behavior from impact inference.

## Verification rules
Every material claim must link to evidence or be labeled as interpretation.

## Stop conditions
Stop when the record is reproducible and reviewable.

## Common failure patterns
Do not include credentials, tokens, or unrelated raw traffic.

## Related skills
See `verification` and `reporting`.
