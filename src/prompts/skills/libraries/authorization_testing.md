---
title: Authorization Testing
phase: testing
aliases:
  - authorization_testing
  - access_control
related_skills:
  - identity_session_analysis
  - traffic_analysis
  - verification
---

# Authorization Testing

## Purpose
Determine whether the application enforces role, tenant, ownership, and function-level access rules consistently. Authorization testing compares the same operation under controlled identities and objects; it must not become uncontrolled enumeration or destructive modification.

## When to use
Use when project intelligence shows multiple roles, tenants, object identifiers, administrative routes, API actions, or differences between UI visibility and server enforcement.

## Prerequisites

- Explicitly authorized test identities with documented roles and tenant/object ownership.
- A small matrix of allowed and denied actions, objects, and endpoints.
- A read-only or reversible operation whenever possible.
- Sanitized baseline evidence and a clear stop condition for data exposure or mutation.

## Workflow

1. Build an authorization matrix: actor, tenant, object owner, operation, expected decision, and evidence reference.
2. Establish the legitimate baseline with the owner identity and record the server-side response.
3. Repeat the same request with the matched non-owner, lower-privilege, cross-tenant, or unauthenticated identity as applicable.
4. Compare status, response shape, side effects, redirects, and audit behavior. Do not infer access from a client-side control alone.
5. For a suspected issue, confirm with a second object or function and a negative control. Store only the minimum evidence necessary to show the boundary failure.

## Evidence to collect
Record actor class (never the secret), tenant/object IDs in sanitized form, operation, baseline and variant references, expected/rejecting signals, response fingerprint, side-effect check, timestamp, and limitations. Redact personal data and tokens before model use.

## Analysis guidance
Separate horizontal access, vertical access, unauthenticated access, tenant isolation, indirect object references, and function-level enforcement. A different error message is not sufficient; the server must expose or change protected state for a material access-control finding.

## Verification rules
Reproduce the same action with controlled identities, verify the object or action was actually accessible, and test a negative control that should remain denied. Confirm that caches, stale sessions, or client state did not create the result.

## Stop conditions
Stop when protected data is confirmed exposed, a state-changing action succeeds unexpectedly, a real user or tenant could be affected, or identity/scope prerequisites become uncertain. Preserve evidence and request plan revision for any broader test.

## Common failure patterns

- Changing several request fields at once so the causal difference is unknown.
- Treating a UI-hidden button as server-side authorization.
- Enumerating object IDs beyond the approved sample.
- Using a real customer account or cross-tenant data.
- Continuing after a confirmed boundary failure instead of documenting and stopping.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE identity | `manage_identity` | Select and label approved test identities without exposing credentials. |
| XEKUTE traffic | `replay_request`, `compare_responses`, `ingest_traffic` | Replay one approved operation and compare bounded response projections. |
| XEKUTE browser | `browser_action` | Verify UI/server differences with a controlled test account. |
| Burp Suite | Windows desktop application | Reissue a single authorized request and retain redacted evidence. |
| PowerShell HTTP | `curl.exe`, `Invoke-WebRequest` | Perform a narrow API comparison when a proxy is not needed. |

## Related skills
See `authentication_testing`, `identity_session_analysis`, `traffic_analysis`, `business_logic_testing`, and `verification`.
Compare equivalent requests, change one authorization variable, preserve expected and rejecting signals, and stop on impact.

## Evidence to collect
Record identity references, object or function references, request pair, response difference, and evidence IDs.

## Analysis guidance
An access difference requires context; distinguish intended denial from an authorization defect.

## Verification rules
Require a negative control and reproducible affected scope.

## Stop conditions
Stop when unauthorized data or action impact is observed.

## Common failure patterns
Do not broaden the object set after finding one interesting discrepancy.

## Related skills
See `identity_session_analysis`, `traffic_analysis`, and `verification`.
