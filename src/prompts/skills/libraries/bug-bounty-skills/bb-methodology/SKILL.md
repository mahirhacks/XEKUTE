---
id: bb-methodology
title: "Bug Bounty Methodology"
description: "Session orchestration for bug bounty work—mindset, non-linear five-phase workflow, wide vs deep routing, and when to switch phases or targets."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# Bug Bounty Methodology

## What the skill is

The master workflow and thinking framework for hunting sessions: how to define daily goals, move non-linearly through recon, mapping, discovery, proof, and reporting, and when to go wide on surface area versus deep on one feature or bug class.

## When to use

At the start of every hunting session, when switching programs or subdomains, when asking what to do next, or when you feel lost between tooling and outcomes. Load before heavy tool use so each action ties to a phase and a harm goal.

## How to use

**Session start (every time)**

1. **Define:** Today’s target feature or domain and the harm outcome (confidentiality, integrity, availability, account takeover, or remote execution).
2. **Select:** One or two vulnerability families only; avoid unfocused scanning.
3. **Execute:** Stay on that selection until rotation rules fire.
4. **Identity:** Decide anonymous vs authenticated; load sessions once if bugs require login so all tools share the same auth context and auditable session identity.

**Route choice**

| Situation | Prefer |
|-----------|--------|
| New program, wildcard scope, scope expansion | **Wide** — maximize surface, ingest leads |
| Known main app, auth bugs, interesting subdomain | **Deep** — map one app or feature thoroughly |

**Phase 1 — Recon**

- Goal: attack surface others skip (shadow IT, archives, cloud assets, alternate APIs).
- Wide: subdomain → DNS → HTTP probe → optional port scan → technology detection.
- Deep: dorks, JS download, hidden parameters, API mapping.
- Decision: live stack → mapping; known product → CVE and misconfiguration checks; persistent block with no bypass signal → skip per time-box; nothing on host in five minutes → next host.
- Mandatory after recon: ingest leads, show queue, pick next lead, update lead status when starting or closing.

**Phase 2 — Mapping and analysis**

- Goal: understand the application like its builder—auth model, roles, money paths, exports, integrations.
- Map endpoints from proxy sitemap and client-side code; note naming inconsistencies, error shape differences, timing deltas, and environment drift (prod vs staging).
- Route signals: OAuth/SAML → auth checklist; ID-like parameters → access-control testing; complex commerce flows → business logic and concurrency; messaging between windows → client-side boundary review.

**Phase 3 — Vulnerability discovery**

- Goal: find a defensible weakness class on the chosen input, not every input.
- Branch by input role: identifiers → object authorization; filters → injection families; URL fetchers → server-side request issues; reflected text → client execution context; uploads → type and path handling; commerce fields → logic and races; auth flows → session and step-up gaps; rich text → template handling; unclear → structured fuzz and error-seeking probes.
- Prefer observable errors first; if none, use timing, out-of-band correlation, or response diffs—always interpreting soft blocks (success status with block body) as defenses, not success.
- Low-impact behavior → seek chain partners; confirmed issue → proof phase; defense blocking → limited bypass attempt then kill; twenty minutes without progress on one endpoint → rotate.

**Phase 4 — Prove and escalate**

- Goal: maximum legitimate business impact within scope and program rules.
- Escalation is decision-tree driven: client-side issues → session or sensitive action impact; object reference → cross-user data or account control; server fetch → internal or cloud credential exposure only if data or role proven; injection → readable sensitive data; redirects → only if tied to auth flows; otherwise find connector weaknesses or stop.
- Check prerequisites (clicks, roles), blast radius, and quantified harm where possible.

**Phase 5 — Validate and report**

- Run full validation gates; fail any gate → kill finding.
- Platform-appropriate report: impact-first title, concise steps, evidence, aligned severity.
- After submit: optional sibling hunt on same module; retest fixes for partial patches; record memory for the program.

**Navigation when stuck**

| Stuck on… | Go to… |
|-----------|--------|
| No subdomains | Recon: alternate sources, dorks |
| Host but no plan | Phase 2: JS and auth map |
| Tests flat | Phase 3: rotate bug class (20 min) |
| Low impact | Phase 4: chain or drop |
| WAF or hard block | Fingerprint, limited encoding variants, then time-box kill |
| One rabbit hole | Stop at 45 minutes; next endpoint |
| New API mid-hunt | Phase 2 before attack |

**Anti-patterns:** program hopping without tenure; tool-only runs without manual proof; hunting without a defined goal; ignoring lead queue after recon.

## Mental model

- Hunting is **proving an attack scenario**, not collecting scanner hits.
- **Four thinking modes:** critical (trust boundaries and developer shortcuts), multi-perspective (horizontal, vertical, time, client channel), tactical (anomalies and diffs), strategic (asymmetry, intuition log, defer unknowns).
- **AI as planner, live traffic as judge:** hypotheses must become single reversible experiments with diffs or identity comparisons.
- **Amateur vs pro:** pros chase design contradictions, chains, minimal prerequisites, and retest fixes for gaps.
- **Two routes:** feature-deep (complex area) or class-deep (find endpoints that match a bug family).

## Tools

| Tool | Job |
|------|-----|
| subfinder / amass / puredns | Subdomain discovery |
| httpx | Live host and tech fingerprint |
| gau / waymore / katana / uro | URL harvest, crawl, dedupe |
| jsluice / mantra | Routes and sinks from JavaScript |
| naabu / rustscan | Port discovery on interesting hosts |
| nuclei | CVE and takeover-oriented templates |
| lead_board.py | Lead ingest, show, next, status |
| eol_check.py | Flag end-of-life stack from fingerprints |
| arjun / paramspider / param discovery scripts | Hidden parameters |
| graphql_audit.sh | GraphQL surface and auth review |
| cicd_scanner.sh | Workflow and pipeline risk signals |
| ffuf | Calibrated fuzzing |
| kxss / dalfox | Reflection filter then XSS-oriented scan |
| ghauri | Structured SQL injection testing |
| interactsh-client | Blind correlation |
| wafw00f / bypass_403 / waf_encoder / waf_response_analyzer | Defense fingerprint and limited variant testing |
| multipart_mutator | Upload parser edge cases |
| takeover_scanner / subzy | Subdomain takeover candidates |
| cloud_recon.sh | Cloud asset permission review |
| secrets_hunter / trufflehog (verified) | Working credential confirmation |
| hunt.py | Orchestrate recon, leads, and scans |
| Burp / Caido | Mapping, manual tests, evidence |

## Expected output if success

- Written session charter: target, harm goal, selected bug classes, auth mode.
- Phase-appropriate artifacts: lead queue after recon, endpoint/auth map after mapping, one confirmed issue with escalation narrative or a justified kill.
- Clear next action from the non-linear map (e.g. return to mapping for new API, or enter validation skill).

## Expected output if not success

- Time-box exit with documented reason (blocked, out of ideas, low value surface).
- Lead board updated; failed techniques noted to avoid repetition.
- No false progression to reporting without Phase 4 proof.

## Verification method

- **Progress clock:** Every twenty minutes, confirm measurable advance (new endpoint, new identity diff, or confirmed kill); otherwise rotate per table.
- **Phase fit:** Current activity matches declared phase; new surface triggers mapping before deep attack.
- **Auth consistency:** Session identity recorded; cross-account tests use two principals when required.
- **Escalation honesty:** Severity claims match demonstrated end state, not intermediate signals (e.g. blind callback without internal data stays unreportable until chain completes).
- **Handoff to triage-validation** before any external submission.
