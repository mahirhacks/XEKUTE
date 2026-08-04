# VAPT SKILL — Deep vulnerability probing

## 1. Purpose
Determine **real impact, scope of affected assets, and exploitability** of a hypothesis that already has supporting signal — without over-testing. Deep probing demonstrates impact (read vs write vs execute, data classes touched) and is only run when exploit validation is explicitly enabled.

## 2. Methodology
1. **Entry gate** — Requires hypothesis with supporting signal (claim state: inferred or observed, not verified), exploit-validation policy enabled, and operator approval.
2. **Reproduce** — Same request twice; different session; control account.
3. **Isolate** — Which parameter, role, and object class are required?
4. **Impact bounds** — Read vs write vs execute; data classes touched (PII, credentials, config).
5. **Blast radius** — Other endpoints sharing the sink; IDOR across object types; lateral API routes.
6. **Chaining** — Does this enable SSRF→internal, XSS→session theft, IDOR→mass export? (hypothesis only).
7. **Severity demonstration** — A01: unauthorized access to another user's object or admin function. A05: server-side execution or persistent storage, not alert-only reflection. A04: cleartext credential or weak crypto in transit with evidence.
8. **Stop** — Sufficient for the finding gate or mark inconclusive with documented limit.

## 3. Tools that help
| Tool | How it helps |
|------|--------------|
| sqlmap (full) | In-depth SQLi exploitation when permitted |
| Custom exploit replay | Scripted replay of the exact supporting sequence |
| Proxy listener | Full request/response capture for evidence |
| Browser devtools | Demonstrating client-side impact (storage, session, DOM) |
| Subagent runner | Parallel deep probes on isolated, in-scope targets |

## 4. Output structure
Evidence package for promotion: minimal reproduction steps (raw HTTP or scripted replay ID), before/after screenshots or response diffs, affected URLs/parameters/roles/object IDs, negative control (authorized user denied or benign variant fails), and limitations (staging only, single sample, WAF present). When to stop deepening: policy denies exploit validation, instability observed, sensitive-data volume threshold hit, or operator stop. Outcomes: verified | rejected (false positive) | inconclusive (impact unknown) — never skip to verified without reproduction.
