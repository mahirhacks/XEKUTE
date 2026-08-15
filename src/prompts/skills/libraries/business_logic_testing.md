---
title: Business Logic Testing
phase: testing
aliases:
  - business_logic_testing
  - business-logic
related_skills:
  - authentication_testing
  - authorization_testing
  - input_validation
---

# Business Logic Testing

## Purpose
Test whether a workflow preserves its intended business invariants across steps, identities, objects, quantities, and state transitions. The focus is on authorization and correctness of the business rule, not on maximizing transactions or creating harmful side effects.

## When to use
Use when a hypothesis concerns order, payment, approval, quota, invitation, recovery, workflow state, object ownership, or any rule that spans more than one request.

## Prerequisites

- A documented normal workflow and the invariant that must remain true.
- Dedicated test accounts, safe test objects, and a rollback or cleanup procedure.
- Explicit limits for amounts, repetitions, notifications, external integrations, and irreversible actions.
- Baseline evidence for each state transition and a plan-approved test sequence.

## Workflow

1. Model the workflow as states and transitions: actor, precondition, action, expected next state, and permitted side effect.
2. Establish one successful baseline using a test object.
3. Vary one dimension at a time: order, replay, identity, object ownership, quantity, timing, missing step, or duplicate request.
4. Compare server-side state, response, audit record, and downstream effects against the invariant.
5. Stop at the first confirmed violation, preserve the smallest reproducible sequence, and separate the observed defect from its possible impact.

## Evidence to collect
Record workflow ID, state before/after, sanitized actor and object references, ordered request IDs, expected invariant, observed result, side-effect check, timestamps, and cleanup status. Keep payment data, personal data, tokens, and full bodies out of model-visible summaries.

## Analysis guidance
A client-side sequence change is not a finding until the server accepts an invalid transition or creates an unauthorized side effect. Distinguish race conditions, replay acceptance, missing authorization, quantity validation, and state-machine confusion. State whether the result is deterministic or timing-sensitive.

## Verification rules
Re-run the minimal sequence with a fresh object or equivalent test case. Use a valid control and an invalid control. Confirm cleanup and ensure the test did not affect real users, billing, inventory, notifications, or external systems.

## Stop conditions
Stop on financial or irreversible action, real-user notification, external side effect, data loss, account lockout, or a violation that is already sufficiently demonstrated. Request plan revision for concurrency, volume, or additional actors.

## Common failure patterns

- Changing multiple state variables so the violated invariant is unclear.
- Testing with production objects or real payment instruments.
- Assuming a successful HTTP status means the business operation succeeded.
- Repeating a confirmed issue until it causes avoidable impact.
- Failing to document cleanup and residual state.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE workflow | `browser_action`, `replay_request`, `compare_responses` | Execute and compare one plan-approved workflow sequence. |
| XEKUTE state | `manage_state`, `manage_identity` | Track test-object state and named identities without secrets. |
| PowerShell HTTP | `Invoke-RestMethod`, `curl.exe` | Exercise a small API transition with explicit request IDs. |
| Burp Suite | Windows desktop application | Reorder or repeat a single approved request sequence. |
| Project inspection | `query_assessment`, `expand_evidence` | Inspect bounded state and evidence projections before deciding the next step. |

## Related skills
See `authentication_testing`, `authorization_testing`, `input_validation`, `identity_session_analysis`, and `verification`.
Model the expected sequence, change one transition, compare state and outcome, and preserve evidence.

## Evidence to collect
Record workflow step, expected invariant, observed state, identity, and evidence references.

## Analysis guidance
Keep a hypothesis separate from a verified business impact.

## Verification rules
Reproduce with a controlled baseline and document limitations.

## Stop conditions
Stop when an action could cause irreversible business impact.

## Common failure patterns
Do not skip required safeguards because an endpoint is technically reachable.

## Related skills
See `authorization_testing`, `input_validation`, and `verification`.
