---
title: Identity and Session Analysis
phase: analysis
aliases:
  - identity_session_analysis
  - session_analysis
related_skills:
  - traffic_analysis
  - authentication_testing
  - authorization_testing
---

# Identity and Session Analysis

## Purpose
Model identity states, session boundaries, token lifecycle, role differences, and tenant context without retaining credentials or token values.

## When to use
Use when the same route behaves differently by user, role, tenant, browser session, authentication state, or token age.

## Prerequisites

- Named, authorized test identities and a documented role/tenant matrix.
- A safe session reset and logout procedure.
- Baseline evidence for anonymous, authenticated, expired, and logged-out states.
- Secret redaction before any evidence is indexed or shown to the model.

## Workflow

1. Define each identity and session state using labels, not usernames, passwords, or token values.
2. Record session creation, renewal, rotation, expiry, logout, and concurrent-session behavior as transitions.
3. Compare the same operation across identities and states while changing one variable at a time.
4. Correlate cookies, bearer metadata, CSRF state, device/browser binding, and server responses without decoding or storing unnecessary secrets.
5. Record whether a difference is expected, unexplained, reproducible, or blocked by a limitation.

## Evidence to collect
Store identity class, tenant/object ownership, session transition, token type/metadata, request and response references, status/redirect, timestamps, and cleanup status. Replace actual tokens, cookies, emails, and IDs with stable redacted labels.

## Analysis guidance
Keep authentication, authorization, and session management separate. A long-lived cookie is an observation; the security conclusion depends on revocation, transport, scope, replayability, and impact. Do not infer identity from client-controlled fields alone.

## Verification rules
Use a fresh session and a negative control. Confirm logout/revocation server-side and check that a result is not caused by cache, browser autofill, proxy reuse, or an expired test fixture.

## Stop conditions
Stop on credential disclosure, unexpected access to another identity, lockout, MFA notification, session fixation affecting a real user, or any state-changing action outside the approved plan.

## Common failure patterns

- Sharing cookies between test identities.
- Recording secrets in terminal history, screenshots, or LTM.
- Calling an identity “admin” without verifying the server-side role.
- Treating a stale session as evidence of current authorization.
- Leaving active sessions or recovery links behind.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE identity | `manage_identity` | Create/select labeled test identities and session states. |
| XEKUTE traffic | `ingest_traffic`, `compare_responses`, `replay_request` | Correlate bounded, redacted traffic across states. |
| XEKUTE browser | `browser_action` | Validate browser session transitions and logout behavior. |
| PowerShell | `Invoke-WebRequest`, `Get-Date` | Make a narrow request or timestamp a controlled transition. |
| Burp Suite / ZAP | Windows desktop applications | Review cookie and authorization metadata with redaction enabled. |

## Related skills
See `authentication_testing`, `authorization_testing`, `traffic_analysis`, `header-check`, and `business_logic_testing`.
Map identity, session, route, and response relationships; then identify controlled comparison opportunities.

## Evidence to collect
Store identity references, sanitized token metadata, response differences, and evidence IDs.

## Analysis guidance
A response difference is an observation until a controlled test explains it.

## Verification rules
Use matched requests and negative controls.

## Stop conditions
Stop on account impact, scope denial, or missing authorization.

## Common failure patterns
Never store raw credentials or session tokens in LTM.

## Related skills
See `traffic_analysis`, `authentication_testing`, and `authorization_testing`.
