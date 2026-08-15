---
title: Header, Token, and CSRF Analysis
phase: verification
aliases:
  - header-check
related_skills:
  - authentication_testing
  - authorization_testing
  - input_validation
---

# Header, Token, and CSRF Analysis

## Purpose
Assess response security headers, cookie attributes, token lifecycle, request-integrity controls, and duplicate-parameter handling using benign, evidence-backed comparisons.

## When to use
Use when project evidence mentions CSP, HSTS, framing, MIME sniffing, cookie flags, JWT/session rotation, CSRF, CORS, or parameter ambiguity.

## Prerequisites

- A baseline response and a test identity appropriate to the flow.
- The browser/client behavior expected by the application.
- Explicit permission for any state-changing request; prefer a read-only endpoint.
- A redaction plan for cookies, authorization headers, CSRF tokens, and personal data.

## Workflow

1. Record baseline headers, cookie metadata, token placement, origin/referrer behavior, and status/redirect without retaining values.
2. Check whether security headers are present, correctly scoped, and consistent across relevant responses.
3. Assess cookie `Secure`, `HttpOnly`, `SameSite`, path, domain, lifetime, and rotation behavior in the correct transport context.
4. Compare authenticated requests with missing, stale, mismatched, or cross-origin integrity signals only when approved.
5. For duplicate or conflicting parameters, test one benign pair and determine server parsing order; do not use harmful payloads.
6. Record observations and route any material issue to `verification`.

## Evidence to collect
Store route, method, response status, selected header names/values after redaction, cookie attribute projection, token lifecycle metadata, origin context, comparison ID, and browser/client version. Hash or reference full captures rather than copying them into context.

## Analysis guidance
Missing headers are not automatically vulnerabilities; consider endpoint sensitivity, browser support, deployment layers, and compensating controls. Treat JWT claims as untrusted input until signature, issuer, audience, expiry, and rotation are verified.

## Verification rules
Use a baseline, variant, and negative control. Confirm a header or token behavior affects the relevant security property and is not added or removed by a proxy, CDN, or test client. Validate CSRF conclusions with the actual browser-origin model.

## Stop conditions
Stop on accidental state change, token disclosure, cross-user impact, lockout, unexpected CORS exposure, or a request that would require a new target or method.

## Common failure patterns

- Reporting a header absence without identifying the protected behavior.
- Logging raw tokens or cookies.
- Treating a decoded JWT as proof of server acceptance.
- Testing CSRF with a request that changes real data.
- Changing several headers or parameters at once.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE traffic | `replay_request`, `compare_responses`, `ingest_traffic` | Compare sanitized baseline and variant metadata. |
| XEKUTE browser | `browser_action` | Observe browser cookie/origin behavior for an approved test flow. |
| PowerShell HTTP | `curl.exe`, `Invoke-WebRequest` | Inspect a single response with explicit redaction. |
| Burp Suite / ZAP | Windows desktop applications | Capture and compare headers in an authorized test project. |
| Windows text tools | `Select-String`, `Get-Content` | Search local, approved captures without Unix-only commands. |

## Related skills
See `authentication_testing`, `authorization_testing`, `identity_session_analysis`, `input_validation`, and `verification`.

## Evidence to collect
Record route, method, identity, expected signal, actual signal, evidence ID, and WSTG check ID.

## Analysis guidance
Classify observations as supporting, rejecting, or inconclusive.

## Verification rules
Use a negative control and preserve before/after exchanges.

## Stop conditions
Stop when the hypothesis is classified or further requests would exceed the approved purpose.

## Common failure patterns
Do not infer a weakness from a missing header without considering the route and threat model.

## Related skills
See `authentication_testing`, `authorization_testing`, and `verification`.
