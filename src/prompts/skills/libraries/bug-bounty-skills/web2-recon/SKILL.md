---
id: web2-recon
title: "Web2 Recon Playbook"
description: "Structured web attack-surface discovery from scope through prioritized leads—load when starting a web target, refreshing assets, or mapping hosts, URLs, and high-signal paths before hunting."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# Web2 Recon Playbook

## What the skill is

A judgment-first pipeline for turning a domain or program scope into a small, prioritized set of live assets, endpoints, and lead buckets ready for class-specific hunting. It covers go/no-go scoring, time limits, triage of URLs, stack-aware prioritization, optional monitoring, and when recovered source or config materially changes the hunt—not a script dump.

## When to use

Load when you begin recon on any in-scope web property, when the lead queue is empty after scope read, when you need to decide whether to invest more time on a target, or when disclosed artifacts (JS, VCS, config) might unlock white-box review. Pair with **web2-vuln-classes** for what to hunt next and **security-arsenal** for submission gates and pattern naming—not for running discovery attacks from this file.

## How to use

**Phase 0 — Program and setup (minutes, not hours)**

- Extract every in-scope asset, explicit exclusions, safe harbor, and accepted impact types from the policy.
- Ensure passive-source credentials and template freshness are configured once; verify core toolchain availability before the first target.
- Create a per-target recon folder so subdomain, live-host, URL, scanner, and disclosure outputs stay comparable across sessions.

**Phase 1 — Passive asset harvest**

- Merge certificate transparency, curated passive DNS feeds, and multi-source subdomain tools; deduplicate aggressively.
- Resolve DNS, then probe HTTP(S) for status, title, and technology fingerprints.
- Apply the **five-minute rule**: if live surface is uniformly blocked, static marketing, or devoid of APIs, forms, auth, and interesting JS, deprioritize or exit unless program economics justify a longer look.

**Phase 2 — URL and path inventory**

- Crawl live hosts with bounded depth; union historical URLs from archives and passive URL tools.
- Run a template scanner on live hosts at medium+ severity as a **signal**, not as a submission queue—triage hits manually.
- On hosts that matter, consider alternate ports and non-standard services; admin and debug stacks often sit off 443.

**Phase 3 — Surface triage and routing**

- Split the URL corpus into buckets: API/versioned routes, auth and OAuth callbacks, uploads, admin-like paths, and parameters that suggest object references, redirects, file paths, or outbound fetches.
- Apply pattern classifiers (gf-style) to route XSS, SSRF, IDOR, SQLi, redirect, LFI, RCE, SSTI, and similar families into separate candidate lists; manually flag theme/profile/render surfaces for stylesheet injection when patterns do not exist.
- Score the **target** before deep work: bounty ceiling, user base or money handling, program age, feature complexity (API, OAuth, GraphQL, uploads), recent change signals, competition, stack familiarity, source availability, and prior disclosures. Below threshold score, limit or skip; note hard kills (tiny max bounty, saturated duplicates-only history, scope reduced to static pages, rules excluding your planned class).

**Phase 4 — JS, secrets, and org leakage**

- From JS URLs, extract hidden routes and client-side endpoints; scan bundles for credential-like material with entropy-aware tools.
- Search public code and org repos for dependency names, env patterns, and registry hints that imply internal packages or mis-deployed secrets—verification belongs in scope and program rules.

**Phase 5 — Source and config disclosure (leverage, not trophy)**

- Treat a reachable VCS root, env file, backup, or directory metadata as **recon enablement**: severity follows what you prove next (live secret, injectable sink, auth logic), not the 200 alone.
- When full source is recovered, pivot to secret history review, dangerous sinks, auth checks, and internal hostnames—not a standalone “exposed .git” report without a chain.

**Phase 6 — Optional depth (only on scored targets)**

- Directory and parameter discovery on high-value hosts; authenticated fuzzing only when sessions are in scope and policy allows.
- Continuous monitors: diff daily subdomain sets, watch JS bundle changes, and track public repo commits touching auth, routes, or permissions.

**Phase 7 — Thirty-minute recon cadence**

- Minutes 0–5: policy and economics.
- Minutes 5–15: standard pipeline through live hosts.
- Minutes 15–25: triage and pattern buckets.
- Minutes 25–30: manual browse with proxy—register, CRUD flows, note APIs missing from passive lists.
- After 30 minutes, prioritize: ID-bearing APIs, uploads, OAuth/SSO, search/filter inputs, admin/debug surfaces—then hand leads to **web2-vuln-classes**.

**Stack → first hunt bias (routing only)**

| Signal | Favor first | Favor second |
|--------|-------------|--------------|
| Rails-like | Mass assignment, numeric route IDOR | SSTI in unsafe rendering |
| Django-like | ViewSet IDOR | Template safety issues |
| Flask-like | SSTI in string templates | Outbound fetch SSRF |
| Laravel-like | Fillable mass assignment | Eloquent ownership gaps |
| Node/Express | Prototype pollution | Path/debug exposure |
| Spring Boot | Actuator/debug surfaces | Template injection |
| ASP.NET | Encrypted view state / crypto misuse | Open redirect on return URLs |
| Next.js | Server actions / data routes SSRF | Framework redirect helpers |
| GraphQL | Introspection-led mutation review | Global node ID access |
| WordPress | Plugin SQLi | REST auth gaps |
| SPA (React/Vue/etc.) | DOM sinks and client-only auth | Cross-frame messaging entry points |

## Mental model

- **Recon produces leads, not findings.** Every artifact answers: “What should we test next, with which identity?”
- **Economics and surface density** gate time; uniform 403/marketing with no auth or API story is a stop signal unless scope forces continuation.
- **Disclosure enables proof.** Bare path exposure is information; the bug is the enabled attack or verified secret.
- **Passive before loud.** Breadth first, then depth on hosts that pass scoring.
- **Version and API drift.** `/v1` vs `/v2` vs internal prefixes often differ in authorization—collect all variants.
- **Monitoring is competitive advantage** on long-running programs, not mandatory on every target.

## Tools

| Tool | Job |
|------|-----|
| Certificate transparency (crt.sh) | Passive subdomain names without API keys |
| Chaos / passive DNS API | High-yield subdomain feed when keyed |
| subfinder, assetfinder | Multi-source passive subdomain aggregation |
| dnsx | Resolve hostnames before HTTP probe |
| httpx | Live detection, status, title, tech hints |
| katana | Bounded crawl from live URLs |
| waybackurls, gau | Historical URL recovery |
| nuclei | Known-issue template triage on live hosts |
| naabu | Alternate port discovery on promising hosts |
| gf | Classify URL lists by vulnerability family |
| LinkFinder | Endpoints embedded in JS |
| SecretFinder, trufflehog | High-signal secret patterns in JS and trees |
| ffuf | Path and parameter discovery with response filtering |
| git-dumper, dvcs-ripper, ds_store parsers | Recover trees from exposed VCS or metadata (policy-bound) |
| GitHub search / GitDorker | Org leakage and internal package names |
| anew | Dedupe streaming recon outputs |
| interactsh-client | OOB correlation when disclosure workflows need it (not standalone impact) |
| Burp Suite (or equivalent) | Manual flow capture during the 30-minute window |

## Expected output if success

- Per-target directory with deduplicated subdomains, live hosts with tech notes, merged URL list, scanner triage file, and triaged buckets (API, auth, upload, admin, pattern-tagged candidates).
- A written go/no-go score and primary stack guess with **first-class hunt** recommendations.
- Lead queue entries routed to vuln-class skills with host, endpoint, parameter, and auth requirement noted.
- When disclosure hits: recovered tree or config inventory plus **follow-up hypotheses** (secrets, sinks, auth), not a filed issue yet.
- Optional monitor baselines (known subdomains, last commit SHA) for ongoing programs.

## Expected output if not success

- Documented kill reason: no live hosts, no in-scope APIs, uniform WAF/static denial, sub-threshold program score, or exclusion of planned classes.
- Time-box respected (five-minute / thirty-minute checkpoints) with explicit “pivot” decision.
- No fabricated leads from scanner noise without manual confirmation path.

## Verification method

- Cross-check every hostname and URL against program scope and safe harbor before storing or testing.
- Confirm live hosts with independent resolution and repeat probe; drop CDN parking and out-of-scope redirects.
- Validate triage buckets by spot-opening URLs—ensure API paths return structured data or auth challenges, not soft 404 marketing pages.
- For disclosure: confirm response body is non-empty and on-scope; distinguish public framework vendor code from application logic before escalating.
- For secrets in JS or repos: follow program rules and **security-arsenal** key-verification guidance—unverified strings stay leads, not findings.
- Re-run a minimal passive diff after major program scope updates to ensure the inventory still matches policy.
