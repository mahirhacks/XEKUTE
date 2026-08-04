# VAPT SKILL — Preflight & engagement readiness

## 1. Purpose
Confirm the engagement is authorized, bounded, and runnable before any info gathering, recon, scanning, or probing. Preflight is the gate that blocks every later stage until authorization, scope, rules of engagement, and runtime policy are sourced and validated.

## 2. Methodology
1. **Authorization** — Verify written authorization (letter/contract) matches the engagement record. Source: [engagement], [settings].
2. **Scope** — Confirm canonical targets, exclusions, wildcards, ports, and paths are documented. Source: [scope].
3. **Rules of Engagement** — Capture testing window, rate limits, concurrency, and forbidden techniques. Source: [roe].
4. **Stop conditions** — Define service-degradation thresholds, sensitive-data exposure rules, out-of-scope redirect behavior, and emergency contact.
5. **Runtime policy** — Confirm active testing, automated scanning, and exploit validation flags; set authority mode (ask/approve/full).
6. **Environment** — Identify production vs staging, shared tenancy, and third-party dependencies that must not be touched.

## 3. Tools that help
| Tool / source | How it helps |
|---------------|--------------|
| Engagement record | Canonical source for authorization letter, scope, and ROE references |
| Settings / policy store | Runtime flags for active testing, automated scanning, exploit validation |
| Scope engine | Validates every target against canonical scope, exclusions, and wildcards |
| Operator questions | Resolves missing authorization, scope, or ROE fields with the operator |

## 4. Output structure
Record readiness per gate as a checklist entry: status (ready | blocked), missing item, unknown field, who must resolve it, and safe parallel work (passive review only). No WSTG check is "passed" during preflight — only readiness gates. Stop rules: do not plan active recon, scans, or probes until authorization and scope are sourced; fail closed to blocked.
