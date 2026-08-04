# VAPT SKILL — Post-vulnerability probing (verification & reporting)

## 1. Purpose
Close the loop after deep probing: independent verification, false-positive elimination, finding promotion, client-ready reporting, and retest criteria. Post-vuln-probing turns a demonstrated impact into a defensible, reportable finding.

## 2. Methodology
1. **Verification workflow** — Restate claim and claim state; list evidence IDs and whether each supports, contradicts, or is neutral; run the false-positive checklist per category (WAF, cache, version mismatch, self-only); verdict: accept | reject | inconclusive — hybrid verifier rules apply.
2. **Finding promotion gate** — Requires reproducible steps, affected scope, severity rationale, WSTG check ID, Top 10:2025 tag, remediation hint. Use record_finding_candidate / ingest — not free-text promotion.
3. **Report sections** — Executive summary (no overclaim); scope and methodology (WSTG 4.x, tools, dates); findings by severity with evidence references; hypothesis backlog (rejected/inconclusive listed, not hidden); coverage matrix (WSTG categories and Top 10 themes — tested | not tested | N/A + reason); limitations and out-of-scope; retest guidance per finding.
4. **Retest planning** — For each verified finding: fixed-build identifier, exact replay command, expected rejecting signal after fix.

## 3. Tools that help
| Tool | How it helps |
|------|--------------|
| Verifier / hybrid rules | Structured accept/reject/inconclusive verdicts |
| Finding ingest / record_finding_candidate | Promotes findings with full evidence metadata |
| Coverage matrix generator | Tracks WSTG and Top 10 coverage across the engagement |
| Replay scripts | Exact retest commands per finding |

## 4. Output structure
Per finding: id, title, severity rationale, WSTG check ID, Top 10:2025 tag, reproducible steps, affected scope, evidence IDs, verdict, remediation hint, retest command, and expected rejecting signal after fix. Reporting notes: A09/A10 issues need demonstrated blind spots — not generic recommendations. Retest: for each verified finding, record fixed-build identifier and expected rejecting signal.
