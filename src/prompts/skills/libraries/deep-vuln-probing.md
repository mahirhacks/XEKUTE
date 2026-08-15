---
title: Deep Impact Analysis
phase: exploitation
aliases:
  - deep-vuln-probing
related_skills:
  - exploitation
  - verification
---

# Deep Impact Analysis

## Purpose
Bound the impact of an evidence-backed hypothesis with the least invasive reproducible action. Deep analysis explains affected scope, confidentiality/integrity/availability consequences, and realistic chaining without turning a proof into uncontrolled exploitation.

## When to use
Use only after a supporting observation, a documented hypothesis, and an approved plan step define the exact action and stop conditions. If the hypothesis is still speculative, use `soft-vuln-probing` or `normal-vuln-probing` first.

## Prerequisites

- An immutable plan snapshot or an explicit user-selected unbound Agent action.
- One affected test object, identity, and target with a safe reset procedure.
- Expected signal, rejecting signal, maximum impact boundary, and evidence requirements.
- A plan for stopping before data extraction, persistence, privilege expansion, or external side effects.

## Workflow

1. Reproduce the minimum known behavior using the baseline and negative control.
2. Isolate one impact dimension: object boundary, privilege boundary, data visibility, state change, or availability.
3. Use synthetic or non-sensitive test data wherever possible and measure before/after state.
4. Record each step and evidence reference; do not branch into a new tool, target, or argument because a surprising result appeared.
5. Stop at the first sufficient proof, clean up, and classify impact with confidence and limitations.

## Evidence to collect
Capture plan step/run ID, identity class, target and object reference, minimal request sequence, before/after projections, negative control, observed impact, cleanup result, timestamps, and source hashes. Store raw artifacts only in the approved evidence store.

## Analysis guidance
Separate demonstrated impact from plausible impact. A read of one synthetic object does not establish access to an entire tenant. Explain prerequisites, exploitability conditions, blast-radius assumptions, and whether any chain was observed or merely theorized.

## Verification rules
Use a fresh session or object where possible, repeat the minimum proof, and confirm the control remains protected. Validate that caches, test fixtures, delegated identity, or stale state did not create the result.

## Stop conditions
Stop on sensitive data exposure, destructive behavior, persistence, privilege escalation, availability degradation, real-user impact, or any action not declared in the approved plan. Unexpected evidence may be recorded and inspected within bounded rules; it never expands executable authority.

## Common failure patterns

- Continuing after sufficient evidence is obtained.
- Treating a hypothetical attack chain as demonstrated.
- Extracting real data when a synthetic object is enough.
- Using a newly discovered target without plan revision and reapproval.
- Leaving test state or credentials active after the proof.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE execution | `run_test_case`, `replay_request`, `browser_action` | Perform only the exact approved proof sequence. |
| XEKUTE evidence | `expand_evidence`, `compare_responses`, `verify_finding` | Inspect bounded evidence and classify the result. |
| PowerShell | `Get-FileHash`, `Invoke-WebRequest` | Verify artifact identity or perform one explicitly scoped request. |
| Burp Suite / ZAP | Windows desktop applications | Reproduce a small, approved request sequence with capture redaction. |

## Related skills
See `exploitation`, `normal-vuln-probing`, `verification`, `finding_documentation`, and `post_exploitation`.

## Evidence to collect
Preserve affected URLs and roles, evidence references, rejected paths, and limitations.

## Analysis guidance
Stop once the claim is sufficiently supported; mark it inconclusive when it is not.

## Verification rules
Never infer impact from a title or status code alone.

## Stop conditions
Stop when the impact boundary is demonstrated or additional action would be materially different.

## Common failure patterns
Do not escalate a test merely to obtain a more dramatic result.

## Related skills
See `exploitation` and `verification`.
