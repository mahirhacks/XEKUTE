---
title: Normal Vulnerability Probing
phase: validation
aliases:
  - normal-vuln-probing
related_skills:
  - vulnerability_analysis
  - input_validation
  - verification
---

# Normal Vulnerability Probing

## Purpose
Test one named, evidence-linked vulnerability hypothesis with a bounded differential. This skill covers ordinary validation across access control, authentication, session, injection, configuration, business logic, and API behavior while keeping impact and request volume low.

## When to use
Use after `vulnerability_analysis` has identified a target, security property, expected signal, rejecting signal, and a plan-approved test action.

## Prerequisites

- A stable project evidence reference and hypothesis statement.
- Exact target, identity, route/operation, arguments, rate limit, and stop condition.
- A baseline, a negative control, and safe test data.
- A decision about whether the test is bound to an approved plan step.

## Workflow

1. Confirm current scope and plan constraints for the exact tool call.
2. Capture the baseline once and record response/status/state projections.
3. Execute the smallest variant that isolates the hypothesis.
4. Compare baseline, variant, and negative control; record only the observed difference and its provenance.
5. Classify `verified`, `rejected`, `inconclusive`, `blocked`, or `needs_plan_revision`.
6. Stop after the verdict and route verified behavior to `verification`.

## Evidence to collect
Record hypothesis ID, plan/run/step ID, target, identity class, operation, input class, baseline/variant/control references, response fingerprints, side-effect check, timestamp, and limitation. Do not store raw payloads, tokens, or complete sensitive bodies in model-visible context.

## Analysis guidance
Name the security property being tested. A changed status code is not enough; explain whether the protected boundary, confidentiality, integrity, availability, or business invariant changed. Treat a surprising response as new evidence, not permission to branch.

## Verification rules
Use a reproducible minimal case, a valid control, and a rejecting control. Confirm the result server-side and check caches, client behavior, identities, redirects, resolved addresses, and parser transformations.

## Stop conditions
Stop on a verified result, scope denial, unexpected side effect, rate-limit signal, availability concern, sensitive data exposure, or a required action not declared by the plan.

## Common failure patterns

- Testing several hypothesis dimensions at once.
- Using broad payload lists when one benign differential is sufficient.
- Treating an error message as proof of exploitability.
- Continuing after a confirmed finding.
- Allowing newly discovered evidence to expand execution actions.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE testing | `run_test_case`, `replay_request`, `browser_action` | Execute the exact approved differential. |
| XEKUTE analysis | `compare_responses`, `verify_finding`, `store_finding` | Classify and persist bounded outcomes. |
| Burp Suite / ZAP | Windows desktop applications | Manually inspect a low-volume request/response comparison. |
| PowerShell HTTP | `curl.exe`, `Invoke-WebRequest` | Submit one explicit variant without Unix shell assumptions. |
| Nuclei | `nuclei.exe` | Use only for a declared, focused check; validate every result manually. |

## Related skills
See `soft-vuln-probing`, `vulnerability_analysis`, `input_validation`, `authorization_testing`, and `verification`.

## Evidence to collect
Link each probe to its exact request, identity, observation, evidence ID, and verdict.

## Analysis guidance
An IDOR hypothesis needs an ownership comparison; an injection hypothesis needs a controlled differential and a negative control.

## Verification rules
Separate observations, hypotheses, and verified findings.

## Stop conditions
Stop when the signal is classified or evidence is insufficient.

## Common failure patterns
Do not promote a plausible response difference without reproducible evidence.

## Related skills
See `vulnerability_analysis` and `verification`.
