---
title: Low-Impact Vulnerability Probing
phase: validation
aliases:
  - soft-vuln-probing
related_skills:
  - vulnerability_analysis
  - verification
---

# Low-Impact Vulnerability Probing

## Purpose
Start with one reversible, benign differential for one hypothesis. This is the default validation stage before normal or deep probing and is designed to maximize information while minimizing target impact.

## When to use
Use when a project observation suggests a security property may differ under one controlled input, identity, header, route, or state condition.

## Prerequisites

- A baseline, controlled variant, negative control, and approved target.
- Safe test data, identity, rate, and cleanup constraints.
- Expected/rejecting signals and an evidence capture plan.

## Workflow

1. State the hypothesis and the one variable to change.
2. Capture the baseline once.
3. Run one benign variant and one negative control, preferably read-only.
4. Compare response, state, identity, and side effects; preserve references and hashes.
5. Classify the result and decide whether to stop, refine the hypothesis, or request a plan-approved deeper step.

## Evidence to collect
Record hypothesis, target, identity class, baseline/variant/control IDs, response fingerprints, input class, timestamp, and limitations. Never store raw secrets or unnecessarily complete bodies.

## Analysis guidance
A differential is meaningful only when the changed variable is causal and the response difference affects the relevant security property. Treat timing/noise, cache, retries, and client transformations as alternative explanations.

## Verification rules
Repeat the smallest comparison when necessary, use a clean session or object, and verify that the negative control behaves as expected.

## Stop conditions
Stop on a verified signal, scope denial, unexpected mutation, sensitive data, availability concern, rate limit, or a need for a broader action.

## Common failure patterns

- Sending a large payload set before establishing a baseline.
- Changing identity, input, and headers simultaneously.
- Treating any error as a vulnerability.
- Retaining complete sensitive exchanges.
- Escalating to deep impact without explicit approval.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE | `replay_request`, `compare_responses`, `browser_action` | Run a controlled baseline/variant/control sequence. |
| PowerShell HTTP | `curl.exe`, `Invoke-WebRequest` | Submit one benign request differential. |
| Burp Suite / ZAP | Windows desktop applications | Inspect low-volume request/response differences. |
| XEKUTE evidence | `expand_evidence`, `verify_finding` | Review bounded evidence and classify uncertainty. |

## Related skills
See `normal-vuln-probing`, `input_validation`, `header-check`, `traffic_analysis`, and `verification`.

## Evidence to collect
Record the expected supporting/rejecting signal and all evidence references.

## Analysis guidance
Use the smallest test that distinguishes the hypothesis from a benign explanation.

## Verification rules
Do not describe a lead as a finding without reproducible evidence.

## Stop conditions
Stop when the differential is classified or a deeper action requires separate approval.

## Common failure patterns
Avoid bulk traffic when one controlled request is sufficient.

## Related skills
See `vulnerability_analysis`, `exploitation`, and `verification`.
