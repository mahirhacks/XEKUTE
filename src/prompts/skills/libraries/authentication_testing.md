---
title: Authentication Testing
phase: testing
aliases:
  - authentication_testing
  - auth_testing
related_skills:
  - identity_session_analysis
  - authorization_testing
---

# Authentication Testing

## Purpose
Evaluate login, logout, enrollment, recovery, MFA, session establishment, and authentication error behavior without causing account harm. The objective is to determine whether the application reliably proves identity and handles failure, not to collect credentials or maximize attempts.

## When to use
Use when project evidence shows an authentication surface or when a hypothesis concerns credential handling, MFA state, account recovery, session creation, or authentication boundaries.

## Prerequisites

- Written authorization for the named application and authentication flows.
- Dedicated test accounts, role labels, recovery contacts, and a lockout/rate-limit agreement.
- A baseline for successful and failed authentication, including expected status, redirect, cookie, token, and audit behavior.
- A stop condition for lockout, notification, data change, or unexpected account access.

## Workflow

1. Map each authentication state: signed out, password accepted, password rejected, MFA pending, MFA passed, recovery pending, and logged out.
2. Test one property per case: credential policy, error consistency, MFA enforcement, recovery authorization, session rotation, logout invalidation, or account enumeration resistance.
3. Use dedicated identities and a small number of controlled attempts. Keep secrets in the approved credential mechanism; redact them from evidence and model context.
4. Compare expected and rejecting signals with a negative control. Record the exact identity state and whether the behavior is reproducible.
5. Store only the sanitized observation, evidence references, impact boundary, and confidence. Escalate a verified issue through `verification` and `finding_documentation`.

## Evidence to collect
Record flow name, identity class, precondition, sanitized request/response references, status/redirect, cookie or token lifecycle metadata, timestamp, attempt count, and limitation. Never store passwords, recovery codes, raw tokens, or session cookies.

## Analysis guidance
Authentication proves who the caller is; authorization decides what that identity may do. Do not classify an authorization defect here unless the authentication state is controlled and documented. Distinguish user enumeration, weak failure handling, and actual account compromise.

## Verification rules
Use a matched negative control and repeat only enough to establish consistency. Confirm that a purported bypass survives a fresh session, correct logout, and an independent identity where applicable. Check whether a finding is a test-account artifact before promoting it.

## Stop conditions
Stop on lockout, MFA fatigue or notification risk, unexpected account state changes, recovery messages sent to real users, rate-limit violations, or any attempt to use an unapproved identity.

## Common failure patterns

- Reusing production identities or real recovery channels.
- Treating a verbose error as a confirmed enumeration issue without a controlled comparison.
- Leaving authenticated sessions active after a test.
- Logging credentials through command-line arguments or screenshots.
- Expanding from login testing into authorization or post-exploitation without a plan revision.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE identity/traffic | `manage_identity`, `replay_request`, `compare_responses` | Maintain named test identities and compare sanitized flow results. |
| XEKUTE browser | `browser_action` | Exercise a permitted login or recovery flow with an approved test account. |
| PowerShell HTTP | `Invoke-WebRequest`, `Invoke-RestMethod` | Send a small, explicit request when browser automation is unnecessary. |
| Burp Suite | Windows desktop application | Capture and compare authorized authentication flows; keep project files protected. |
| OWASP ZAP | Windows desktop application | Run a bounded passive review; avoid active scanning unless the plan explicitly permits it. |

## Related skills
See `identity_session_analysis`, `authorization_testing`, `header-check`, `traffic_analysis`, and `verification`.

## Evidence to collect
Record identity state, endpoint, expected behavior, observed behavior, and evidence references.

## Analysis guidance
Separate authentication from authorization and session-management behavior.

## Verification rules
Require reproducibility and avoid destructive account operations.

## Stop conditions
Stop on lockout risk, account impact, or scope denial.

## Common failure patterns
Do not guess passwords or bypass configured rate limits.

## Related skills
See `identity_session_analysis` and `authorization_testing`.
