---
title: Finding Verification
phase: verification
aliases:
  - verification
  - finding_verification
related_skills:
  - vulnerability_analysis
  - reporting
---

# Finding Verification

## Purpose
Determine whether a hypothesis is verified, rejected, inconclusive, blocked, or requires plan revision using reproducible, evidence-linked reasoning.

## When to use
Use before storing or reporting a security finding, after a probe reaches a terminal outcome, and during retest.

## Prerequisites

- Reproducible or adequately bounded evidence.
- Affected scope, identity/target context, expected and rejecting signals.
- Baseline, negative control, source hash, cleanup status, and known limitations.
- Current plan/run/step context where the action was plan-bound.

## Workflow

1. Restate the security property and hypothesis in observable terms.
2. Review baseline and variant evidence, source integrity, scope, identity, redirects, and resolved addresses.
3. Repeat the smallest proof when safe and apply a negative control.
4. Compare server-side state, response, impact, and reproducibility.
5. Classify the result and state exactly what is demonstrated, what is inferred, and what remains unknown.
6. Store a verified finding or preserve the rejected/inconclusive result with its evidence gap.

## Evidence to collect
Keep hypothesis ID, plan/run/step ID, target, identity class, baseline/variant/control references, source hashes, observed impact, timestamps, cleanup, and limitations. Redact secrets and use stable labels.

## Analysis guidance
Verification is not severity scoring. A reproducible anomaly may be real but not security-impacting; a plausible risk may be unverified. Explain causal evidence and alternative explanations.

## Verification rules
Require a valid control, a rejecting control, reproducibility or a documented constraint, and current source integrity. Do not rely solely on a scanner, version string, status code, or client-side behavior.

## Stop conditions
Stop when a stable verdict exists, evidence is sufficient, a safety boundary is reached, or the next action would be outside the approved plan.

## Common failure patterns

- Calling an observation verified without a negative control.
- Ignoring scope or identity drift.
- Deleting rejected/failed evidence.
- Using impact assumptions as proof.
- Continuing to test after a sufficient result.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE verification | `verify_finding`, `compare_responses`, `expand_evidence` | Inspect bounded evidence and classify the result. |
| XEKUTE execution | `run_test_case`, `replay_request`, `browser_action` | Repeat the minimum approved proof/control. |
| Windows hashing | `Get-FileHash` | Confirm evidence source integrity. |
| Burp Suite / ZAP | Windows desktop applications | Review an authorized comparison with redaction. |

## Related skills
See `vulnerability_analysis`, `soft-vuln-probing`, `normal-vuln-probing`, `finding_documentation`, and `retest`.

## Evidence to collect
Record proof references, control references, affected entity, and confidence.

## Analysis guidance
Keep rejected and inconclusive outcomes because they prevent repeated work.

## Verification rules
A finding requires reproducible evidence and an explicit limitation statement.

## Stop conditions
Stop when the result is sufficient to classify or when further testing adds no confidence.

## Common failure patterns
Do not report a hypothesis as confirmed merely because it is plausible.

## Related skills
See `vulnerability_analysis` and `reporting`.
