---
id: bug-bounty
title: "Bug Bounty Master Playbook"
description: "End-to-end bug bounty playbook from scope through recon, learning the target, focused hunting, validation, and reporting when you need one skill to anchor a full engagement."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# Bug Bounty Master Playbook

## What the skill is

A consolidated operating model for paid vulnerability research: how to stay in scope, prioritize harm over novelty, run the full lifecycle without drowning in noise, and hand off to methodology and triage skills when judgment or gates matter more than breadth.

## When to use

Load this skill for any bug bounty engagement—first day on a program, mid-hunt when you need the big picture, or when you are choosing between recon sprawl and deep feature work. Pair it with **bb-methodology** for session structure and **triage-validation** before any submission.

## How to use

**North-star question (kill gate):** Can a realistic attacker cause concrete harm—financial loss, sensitive data exposure, account compromise, or server compromise—without the victim taking unusual steps? If not, stop and pivot.

**Phase 0 — Scope and intent**

- Read program policy, asset list, and exclusions before touching the target.
- Confirm each hostname, app, and API belongs to the program; treat third-party and internal assets as out of scope unless explicitly included.
- Pick one primary harm goal for the session (confidentiality, integrity, availability at app level, account takeover, or remote execution) and one or two vulnerability families to pursue deeply.

**Phase 1 — Recon (surface, not spiral)**

- Enumerate assets passively first, then probe what is live; collect URLs from crawl and archives.
- Fingerprint stack and business-critical flows; note auth boundaries and multi-tenant patterns.
- Time-box dead hosts and uniform denial responses; do not spend long cycles on blocked paths with no new signal.
- Ingest recon signals into a lead queue: route each lead to a focused hunt or audit skill; track start, kill, and report states so nothing is forgotten.

**Phase 2 — Learn (pre-hunt intelligence)**

- Use the product as a normal user; map payments, sharing, admin, and integrations.
- Review disclosed reports and changelogs for repeat anti-patterns on similar stacks.
- Build a short threat model: crown jewels, trust boundaries, and where authorization is likely inconsistent (new features, mobile vs web APIs, legacy versions).

**Phase 3 — Hunt (depth over spray)**

- One bug class at a time on high-value features; keep structured notes (leads, dead ends, anomalies, confirmed issues).
- Prefer authenticated testing when bugs live behind login; use separate identities when testing cross-account access.
- When one issue is confirmed, expand to sibling endpoints and composable weaknesses (cluster hunting) before filing—chains often define severity, not the first signal alone.
- Treat automation as triage input; confirm with manual, identity-aware experiments.
- Apply session discipline: short probes on cold targets, rotate after prolonged stagnation on one thread.

**Phase 4 — Validate**

- Run the seven-question gate and four pre-submission checks (see **triage-validation**); any hard fail means discard, not “maybe later.”
- Reproduce from a clean session; capture evidence of impact, not merely anomalous status codes.
- For auth-related bugs, verify behavior across anonymous, victim, and attacker identities so the root cause is classified correctly.

**Phase 5 — Report**

- Impact-first title and summary; reproducible steps at the HTTP level; severity aligned with program definitions and CVSS where required.
- One report per coherent attack scenario; quantify scale when honest and provable.
- After submit, retest fixes and watch for incomplete patches as new findings.

## Mental model

- **Impact-first:** Vulnerability labels are secondary to what an attacker gains.
- **Prove scenarios, not hypotheses:** “Could” and unreachable code are not findings.
- **Asymmetry:** Defenders must close every hole; you need one credible path.
- **Feature and trust-boundary thinking:** Hunt how components interact, not isolated endpoints.
- **Second-order and version drift:** Stored inputs, async jobs, and API/version mismatches often hide authorization gaps.
- **T-shaped depth:** Go deep on one area while maintaining broad awareness of where to route next.
- **Lead board:** The program remembers leads; you focus on one thread at a time.

## Tools

| Tool / artifact | Job |
|-----------------|-----|
| Subdomain enumerators (e.g. subfinder, assetfinder) | Discover hostnames in scope |
| DNS resolver (dnsx) | Resolve names before probing |
| HTTP prober (httpx) | Live hosts, status, technology hints |
| URL collectors (gau, waybackurls, katana) | Historical and crawled endpoints |
| Template scanner (nuclei) | Prioritize known-issue templates on live hosts |
| Fuzzer (ffuf) | Discover paths and parameters with calibrated filtering |
| Pattern helpers (gf) | Bucket URLs by vulnerability family for manual follow-up |
| Secret scanners (trufflehog, gitleaks) | Find credentials in repos and JS—only count if access is proven in scope |
| Static analysis (semgrep) | Surface risky patterns in source when code is available |
| Out-of-band client (interactsh) | Correlate blind behaviors without assuming impact from DNS alone |
| Hunt orchestrator (hunt.py) | Chained recon, lead ingest, and optional specialized modes |
| Lead board (lead_board.py) | Ingest, prioritize, and route recon signals |
| Proxy (Burp/Caido) | Manual mapping, diffing identities, evidence capture |
| Program APIs / scope export | Authoritative in-scope asset list |

## Expected output if success

- A scoped map of assets and prioritized leads with owners (which skill or thread handles each).
- Session notes separating confirmed issues, open leads, and killed paths.
- For each candidate submission: reproducible cross-identity proof, clear impact statement, in-scope asset reference, deduplication check completed, and report draft passing all validation gates.
- Documented chains where multiple weaknesses combine into one reportable scenario.

## Expected output if not success

- Explicit stop conditions: out of scope, theoretical impact, duplicate or intended behavior, or time-box expiry with no new signal.
- Updated lead board with killed or deferred items and reason (noise, blocked, low value).
- No draft report and no platform submission until validation passes.

## Verification method

- **Scope:** Asset identifier matches program policy; production vs staging rules respected.
- **Reality:** Issue reproduces with recorded requests/responses; not inferred from code or scanner text alone.
- **Impact:** Demonstrated harm matches program tiers; weak standalone classes escalated only with an end-to-end chain proven in scope.
- **Identity:** For access-control findings, show the wrong principal accessing the wrong object; distinguish missing authentication from broken object authorization.
- **Gates:** All seven validation questions yes; four pre-submission gates pass; finding not on the always-reject list unless a chain is fully demonstrated.
- **Peer triage test:** A skeptical reviewer could agree it is a real, in-scope bug without special victim behavior.
