---
title: Retest and Regression Verification
phase: retest
aliases:
  - retest
  - regression_testing
related_skills:
  - verification
  - reporting
---

# Retest and Regression Verification

## Purpose
Determine whether a previously documented issue remains reproducible after a change, using the original proof and a clearly stated remediation predicate. A retest updates status; it does not erase the historical finding or evidence.

## When to use
Use after a remediation claim, release, configuration change, or project-requested regression check.

## Prerequisites

- Original finding, plan/run references, affected scope, and proof/control evidence.
- Description of the change and expected remediated behavior.
- Test identity, environment/version, and safe rollback/cleanup instructions.
- Current scope and exclusions.

## Workflow

1. Confirm the original target and security property have not materially changed.
2. Reproduce the original control once and compare with historical evidence.
3. Execute the remediated test using the smallest equivalent action.
4. Run the rejecting/negative control and compare status, response, state, and side effects.
5. Classify `fixed`, `partially_fixed`, `still_reproducible`, `inconclusive`, or `not_testable`.
6. Record environment, version, evidence references, remaining limitations, and next retest condition.

## Evidence to collect
Keep original finding ID, change/version, target and identity class, baseline/control/variant references, timestamps, hashes, cleanup, and result rationale. Store new evidence separately and link it to the historical record.

## Analysis guidance
“Fixed” means the original security property is restored under the tested conditions. A changed error message or UI is not enough. If scope, environment, or identity differs, state whether the result is comparable.

## Verification rules
Use the same minimal proof where possible, a negative control, and source-integrity checks. Never delete failed retest evidence; it explains why a finding remains open.

## Stop conditions
Stop on changed target, missing remediation details, destructive behavior, unexpected data, scope denial, or a retest action outside the approved plan.

## Common failure patterns

- Retesting only the UI and not the server-side behavior.
- Calling a finding fixed after one changed response.
- Comparing different environments without disclosure.
- Removing historical evidence.
- Expanding the retest into a new assessment.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE retest | `run_test_case`, `replay_request`, `browser_action` | Repeat the original bounded proof and control. |
| XEKUTE comparison | `compare_responses`, `verify_finding` | Compare historical and current sanitized projections. |
| Windows hashing | `Get-FileHash` | Verify report and artifact identity. |
| Burp Suite / ZAP | Windows desktop applications | Reproduce an approved web request with redaction. |

## Related skills
See `verification`, `finding_documentation`, `reporting`, and `post-vuln-probing`.

## Evidence to collect
Link original and retest evidence while preserving timestamps and test identity.

## Analysis guidance
A changed response is not automatically proof of remediation if the control changed too.

## Verification rules
Use equivalent conditions and record residual risk.

## Stop conditions
Stop when the finding is verified fixed, still present, or inconclusive.

## Common failure patterns
Do not reuse stale credentials or assume the environment is unchanged.

## Related skills
See `verification` and `reporting`.
