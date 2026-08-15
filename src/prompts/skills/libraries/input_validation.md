---
title: Input Validation
phase: testing
aliases:
  - input_validation
  - input-validation
  - sqlmap
related_skills:
  - traffic_analysis
  - business_logic_testing
  - verification
mcp:
  - server: sqlmap
    tools:
      - name: sqlmap_scan_url
        modes: [agent]
        access: mutate
        target_types: [network]
        target_arguments: [url]
      - name: sqlmap_enumerate_databases
        modes: [agent]
        access: mutate
        target_types: [network]
        target_arguments: [url]
      - name: sqlmap_enumerate_tables
        modes: [agent]
        access: mutate
        target_types: [network]
        target_arguments: [url]
      - name: sqlmap_enumerate_columns
        modes: [agent]
        access: mutate
        target_types: [network]
        target_arguments: [url]
      - name: sqlmap_get_banner
        modes: [agent]
        access: mutate
        target_types: [network]
        target_arguments: [url]
      - name: sqlmap_get_current_user
        modes: [agent]
        access: mutate
        target_types: [network]
        target_arguments: [url]
      - name: sqlmap_get_current_db
        modes: [agent]
        access: mutate
        target_types: [network]
        target_arguments: [url]
      - name: sqlmap_advanced_scan
        modes: [agent]
        access: mutate
        target_types: [network]
        target_arguments: [url]
---

# Input Validation

## Purpose
Assess how an application parses, normalizes, constrains, and represents inputs across query strings, paths, headers, forms, JSON, XML, and uploaded files. Focus on the validation invariant and safe differentials, not on indiscriminate payload generation.

## When to use
Use when evidence identifies a parser boundary, type conversion, canonicalization issue, reflection point, upload flow, or mismatch between client and server validation.

## Prerequisites

- A named endpoint/field and the intended type, range, encoding, and business constraint.
- Safe test values, a baseline, a rejecting control, and a maximum request count.
- Explicit permission for state-changing or file-upload tests.
- Redaction for secrets, personal data, and uploaded content.

## Workflow

1. Document the normal representation and server-side expected behavior.
2. Vary one property at a time: missing, empty, boundary, type, encoding, duplicate, order, length, or normalization form.
3. Observe parser acceptance, canonical value, response, storage, downstream use, and error handling.
4. Compare client-side and server-side decisions; only server-side behavior determines enforcement.
5. Use a benign marker and negative control for reflection or differential tests. Preserve the smallest reproducible case.

## Evidence to collect
Record endpoint, field/path, input class (not sensitive value), normalized representation, response/status reference, storage/output effect, parser/version context, and limitation. Hash or reference full bodies and uploaded artifacts.

## Analysis guidance
Distinguish validation, encoding, output escaping, parser confusion, and business-rule failures. A rejected request may still reveal a useful normalization observation; an accepted boundary value is not a vulnerability without a broken security property or meaningful impact.

## Verification rules
Repeat with a known-good input and a rejecting input. Confirm the behavior at the security-relevant sink and check for proxy, browser, or serialization transformations. For files or structured bodies, verify both content type and actual parser behavior.

## Stop conditions
Stop on unexpected execution, persistent state change, data exposure, server errors that threaten availability, large input requirements, or a request outside the plan’s declared argument constraints.

## Common failure patterns

- Treating a client-side validation message as server enforcement.
- Sending multiple malformed fields and losing causality.
- Retaining raw sensitive input in logs or evidence.
- Using a destructive upload or parser stress test when a benign boundary is enough.
- Ignoring canonicalization differences between layers.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE request testing | `replay_request`, `browser_action`, `compare_responses` | Run one controlled input differential and compare projections. |
| PowerShell HTTP | `Invoke-RestMethod`, `curl.exe` | Submit explicit, bounded request variants. |
| Burp Suite / ZAP | Windows desktop applications | Inspect serialization and parser-boundary differences. |
| XEKUTE evidence | `expand_evidence`, `verify_finding` | Inspect sanitized response evidence and classify results. |
| Windows files | `Get-FileHash`, `Get-Content` | Verify uploaded test artifacts and local fixtures. |

## Related skills
See `traffic_analysis`, `business_logic_testing`, `header-check`, `vulnerability_analysis`, and `verification`.
Change one input dimension at a time, preserve controls, and compare response and state effects.

## Evidence to collect
Store parameter reference, test class, expected signal, observed signal, and evidence pointer.

## Analysis guidance
Avoid treating an error message alone as exploitable impact.

## Verification rules
Require a reproducible impact and negative control.

## Stop conditions
Stop on destructive behavior, data loss, or scope denial.

## Common failure patterns
Do not send unbounded payloads or repeat equivalent tests.

## Related skills
See `traffic_analysis`, `business_logic_testing`, and `verification`.
