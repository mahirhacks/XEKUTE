---
title: Automated Security Scanning
phase: analysis
aliases:
  - automated-security-scan
related_skills:
  - enumeration
  - vulnerability_analysis
  - verification
---

# Automated Security Scanning

## Purpose
Use automation to reduce repetitive discovery and produce reviewable leads. A scanner result is evidence of a signal, never a verified vulnerability. Every automated run must be bounded, attributable, and followed by manual validation.

## When to use
Use after `preflight`, `scope_validation`, and attack-surface mapping have defined a small target set and an explicit scan question. Prefer a focused template or check over a broad scan wave.

## Prerequisites

- Approved hosts, URLs, paths, identities, request rate, concurrency, and test window.
- Tool and template versions, configuration files, output directory, and retention policy.
- A baseline or known-good response for the check.
- A plan step that states what may be scanned and what signals require a stop.

## Workflow

1. Validate every target through XEKUTE scope and plan checks before launch.
2. Run the smallest scanner configuration that answers the question. Use passive or low-impact checks first.
3. Capture command line/configuration, version, timestamp, target list, rate, exit code, and output hash.
4. Parse output into bounded observations with source pointers; do not paste complete scanner output into chat or LTM.
5. For each material lead, create a focused hypothesis, reproduce with a controlled request, and classify false-positive, inconclusive, or verified.
6. Stop and preserve partial output when the scanner receives a scope denial, rate limit, unexpected state change, or tool error.

## Evidence to collect
Store the run ID, scanner name/version, template or rule ID, exact target references, configuration hash, result summary, representative evidence, and known limitations. Keep raw output in the project artifact store and redact secrets from all projections.

## Analysis guidance
Rank results by confidence and impact only after confirming affected scope and reproducibility. Distinguish missing coverage, tool errors, and negative results. Scanner severity labels are hints; XEKUTE findings require evidence-linked verification.

## Verification rules
Reproduce a material hit with `replay_request`, `browser_action`, or `run_test_case` according to the approved plan. Use an expected signal and a rejecting signal, and record a negative control. Do not use a second scanner as the only validation.

## Stop conditions
Stop on target drift, rate-limit or availability impact, repeated parser failures, suspected data mutation, unexpected authentication behavior, or a lead that requires a new action outside the approved plan.

## Common failure patterns

- Running a default full scan against an unreviewed target list.
- Treating “no result” as complete coverage.
- Reporting a rule title without reproducing the behavior.
- Keeping secrets in scan command lines, logs, or screenshots.
- Allowing a scanner follow-up to expand hosts, paths, or payload classes silently.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| Nuclei | `nuclei.exe` | Focused, approved template checks with explicit rate and target files. |
| Nmap | `nmap.exe` | Narrow service/version inventory when explicitly approved; preserve XML/normal output hashes. |
| OWASP ZAP | Windows desktop application | Passive analysis or a tightly scoped active scan under a plan step. |
| Burp Suite | Windows desktop application | Controlled proxy-assisted checks and evidence capture. |
| XEKUTE | `run_test_case`, `query_assessment`, `store_finding` | Keep scanner output bounded, correlated, and separately verified. |

Use Windows builds only. Do not assume non-Windows shell scripts or path syntax exist on the host.

## Related skills
See `enumeration`, `vulnerability_analysis`, `soft-vuln-probing`, `verification`, and `reporting`.

## Evidence to collect
Store the exact target set, version, parser result, output path, and limitations.

## Analysis guidance
Promote a scanner hit only after a focused hypothesis, reproducible evidence, and a false-positive check.

## Verification rules
Confirm affected scope and expected/rejecting signals independently.

## Stop conditions
Stop at rate, scope, or evidence limits.

## Common failure patterns
Do not report a scanner title as a verified vulnerability.

## Related skills
See `vulnerability_analysis` and `verification`.
