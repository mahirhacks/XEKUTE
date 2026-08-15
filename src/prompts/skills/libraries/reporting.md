---
title: Assessment Reporting
phase: reporting
aliases:
  - reporting
  - report_generation
related_skills:
  - finding_documentation
  - retest
---

# Assessment Reporting

## Purpose
Present verified findings, completed work, limitations, unresolved hypotheses, coverage, and remediation guidance in a reviewable report. Reporting is a projection of canonical project state; it must not invent certainty or expose secrets.

## When to use
Use for interim, final, executive, technical, and retest reporting after evidence and finding statuses are reviewed.

## Prerequisites

- Current finding statuses and evidence references.
- Scope, methodology, dates, identities, tools, and coverage limits.
- Approved audience and redaction rules.
- Explicit separation of verified findings, observations, rejected hypotheses, and untested areas.

## Workflow

1. State scope, dates, methodology, assumptions, exclusions, and limitations.
2. Summarize coverage by asset, route/service, identity, phase, and evidence status.
3. Present each verified finding with title, affected scope, severity rationale, prerequisites, reproduction references, impact, remediation, and retest condition.
4. Include unresolved, rejected, blocked, and out-of-scope items where they affect risk interpretation.
5. Review links, hashes, timestamps, redaction, and consistency with canonical findings.
6. Export the approved report to the workspace or designated destination and record its hash/version.

## Evidence to collect
Use stable finding/evidence IDs, source hashes, sanitized excerpts, timestamps, coverage counts, and report version metadata. Keep secrets and raw artifact bodies outside the model-visible report.

## Analysis guidance
Severity should reflect demonstrated impact and realistic prerequisites. Explain uncertainty and residual risk. Do not turn a methodology gap into a clean result or a scanner label into a verified claim.

## Verification rules
Cross-check every finding against canonical evidence and current status. Ensure no report link points to a deleted or mutated artifact without an explicit warning.

## Stop conditions
Stop publication when findings are unverified, scope is unresolved, redaction fails, evidence hashes mismatch, or the audience/retention policy is unknown.

## Common failure patterns

- Reporting raw credentials, tokens, personal data, or full sensitive responses.
- Omitting limitations and coverage gaps.
- Overstating impact or remediation certainty.
- Updating a report without a version/hash.
- Treating absence of findings as proof of absence of vulnerabilities.

## Windows tool table

| Tool | Windows form | Appropriate use in this skill |
|---|---|---|
| XEKUTE reporting | `query_assessment`, `expand_evidence`, `store_finding` | Read canonical status and preserve report links. |
| Windows editor | XEKUTE editor or approved Markdown/Word editor | Draft and review redacted reports. |
| Windows hashing | `Get-FileHash` | Record report and attachment integrity. |
| PowerShell files | `Get-Item`, `Get-ChildItem` | Check approved report outputs inside the workspace. |

## Related skills
See `finding_documentation`, `verification`, `retest`, and `vapt_cycle`.

## Evidence to collect
Use stable canonical references and include enough detail for reproducibility.

## Analysis guidance
Do not present candidate or rejected hypotheses as verified findings.

## Verification rules
Reports distinguish verified, rejected, and inconclusive outcomes.

## Stop conditions
Stop when all report claims have sources or explicit qualification.

## Common failure patterns
Avoid unsupported severity or impact claims.

## Related skills
See `finding_documentation`, `verification`, and `retest`.
