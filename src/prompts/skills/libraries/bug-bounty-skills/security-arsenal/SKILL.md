---
id: security-arsenal
title: "Security Arsenal (Judgment & Routing)"
description: "Submission judgment, triage gates, pattern vocabulary, tool-routing for WAF and scanners, and external reference map—load when deciding if a finding is reportable or which helper fits the obstacle, not for payload cookbooks."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# Security Arsenal (Judgment & Routing)

## What the skill is

The program’s **triage and routing layer**: what never to submit, what only pays when chained, how to interpret WAF and rate-limit behavior, which gf-style pattern names bucket URLs, which wordlist categories exist, how framework fingerprints should route to focused audits, and where external methodology libraries live. Cheatsheet “try first” priorities and reference catalog are absorbed here as judgment tables—not duplicated attack content.

## When to use

Load when a signal might be Low/Informative, when duplicates hurt your stats, when blocked by 403/WAF/rate limits, when choosing encoder or scanner settings conceptually, or when you need a pointer to OWASP, HowToHunt, writeup corpora, takeover lists, or key-verification guides. Do **not** load expecting copy-paste payloads; pair **web2-vuln-classes** for class choice and class-specific audit skills for proof work.

## How to use

**Gate 1 — Always rejected**

- Before investing proof effort, scan the standing rejection list (missing security headers alone, SPF/DMARC, introspection without auth impact, version banners without exploitable CVE in range, self-XSS, logout CSRF, open redirect without token chain, DNS-only SSRF, host header without reset poison chain, rate limits on non-critical forms, session logout quirks, internal IP in errors, weak TLS/cookies alone, broken external links, autocomplete on passwords, etc.).
- If the finding matches, **stop**—do not “try anyway” unless you already have a completed chain that changes category.

**Gate 2 — Conditionally valid (chain required)**

- Open redirect → OAuth code theft; clickjacking/CSS overlay → sensitive action; CORS wildcard → credentialed data read; CSRF → state-changing impact; rate-limit bypass → successful OTP/token guess; SSRF DNS → internal data; host header → poisoned reset link; prompt injection → other-user data or tool exfil; bucket listing → live keys in objects; self-XSS → CSRF-triggered victim; subdomain takeover → OAuth on subdomain; GraphQL schema → mutation/IDOR proof.
- Rule: **prove the chain end-to-end**, then report once—never file A with “could combine with B.”

**Gate 3 — Obstacle routing (403 / WAF / soft block)**

- Establish a block baseline: same host with a known-bad probe; soft 200 block pages count as blocked.
- Positive bypass **signals** (not automatic wins): reach auth middleware (401), backend exception (500), or origin (502/503) with body diverging from block fingerprint.
- Decision tree: run structured 403 bypass probes (header spoof families, path encoding, method tampering) → fingerprint WAF vendor → apply vendor-appropriate encoding/content-type/multipart differentials → rotate rate and threads on fuzzers → time-box (~five minutes) then kill thread.
- Extract WAF log IDs from responses when present for report triage correlation.

**Gate 4 — Rate limits**

- Test counter key sensitivity: version path, case, trailing slash, dummy query, fragment (client-only), email alias tricks—only on in-scope, policy-allowed endpoints.
- Prefer single-connection multiplexing or batching semantics (HTTP/2, GraphQL aliases, WebSocket) only when assessing **critical** auth flows, not generic search forms.

**Gate 5 — Framework fingerprint → audit route**

- Spring actuator/heapdump/env → secret extraction or dangerous actuator write surfaces—not health alone.
- SpEL vs property-placeholder reflection—confirm true expression sink before claiming execution.
- Log4j/JNDI, Fastjson/Jackson typing, ThinkPHP routing, Werkzeug debug console, Tomcat manager, Struts OGNL, OFBiz auth bypass, Confluence OGNL: route to dedicated verification only after version in vulnerable range and scope permits active test; banner-only stays rejected.

**Gate 6 — Pattern vocabulary (gf)**

- Use pattern names to sort URL lists: xss, ssrf, idor, sqli, redirect, lfi, rce, ssti, debug_logic, secrets, upload-fields, cors—manual grep for theme/profile/render CSS surfaces where no pattern exists.

**Gate 7 — Wordlist categories (conceptual)**

- Common dirs, API path seeds, parameter names, sensitive file names, backup/temp extensions—apply only on scored targets with calibrated fuzz filters (status, size, word count) to drop WAF noise.

**Per-class quick priority (methodology cheatsheet)**

| Class | First checks (order) |
|-------|----------------------|
| IDOR | ID swap; UUID swap; param pollution; token swap; body/GraphQL/WS IDs; mass-assign role fields |
| XSS | Reflected encoding; DOM sinks and postMessage; stored fields; mutation contexts |
| SSRF | Loopback/metadata only as hints; redirect and parser differentials; OOB for blind fetchers |
| Open redirect | Chain feasibility to OAuth |
| SQLi | Error/time/boolean hints; DBMS match stack; prove readable value not error-only |
| CSRF | State change without token/SameSite |
| OAuth | redirect_uri, state, PKCE, implicit leakage |
| Race | Parallel redeem/withdraw/create |
| Upload | Extension/MIME/parser layers—not execution from this doc |
| Takeover | CNAME fingerprint vs provider claim list |
| MFA | Response trust, step skip, reuse, backup flow |

**External references (when internal playbooks run short)**

| Category | Representative sources | Use for |
|----------|-------------------------|---------|
| Methodology | HowToHunt, HolyTips, AllAboutBugBounty, KingOfBugbountyTips, awesome-oneliner-bugbounty, OWASP WSTG, OWASP-Web-Checklist | Checklist depth, coverage tracking |
| Writeups | Awesome-Bugbounty-Writeups, ngalongc reference, bounty-targets-data | Patterns by class, scope ideas |
| Tools catalog | awesome-bugbounty-tools, WebHackersWeapons, awesome-api/cloud-security | Pick alternates to wrapped tools |
| OSINT / dorks | Dorks collections, github-dorks, GitDorker | Org leakage discovery |
| Takeover | can-i-take-over-xyz, dnsReaper (wrapped scanner) | Provider-specific claim steps |
| Key verification | keyhacks | Prove leaked credential class safely |
| AI / agent recon | Cybersecurity skills corpora, recon MCP patterns | Cross-pollinate autonomous recon design |

Mirror or grep upstream repos for detail; this skill stays the **local gate and router**.

## Mental model

- **Validity ratio is an asset.** N/A and duplicate submissions cost more than a skipped lead.
- **Soft 200 is still a block** until body and length diverge from baseline.
- **Chains define tier.** Standalone informational signals are recon or N/A.
- **Vendor fingerprint steers encoding strategy**, not random mutation.
- **Framework quick-wins require version + PoC**, not headers alone.
- **References are indexed, not inlined**—avoid stale payload duplication in-repo.

## Tools

| Tool | Job |
|------|-----|
| bypass_403.sh (project) | Structured 403/WAF bypass probes with verdicts |
| waf_encoder.py (project) | Generate encoding variants by attack class label |
| waf_response_analyzer.py (project) | Classify block vs bypass responses |
| multipart_mutator.py (project) | Parser-differential variants for upload tests |
| wafw00f | Fingerprint WAF product |
| ffuf / wfuzz / nuclei | Discovery and scanning with rate, header, and filter discipline |
| sqlmap + tamper scripts | Automated SQLi only after manual confirmation—tamper sets grouped by vendor in upstream docs |
| Burp extensions (Param Miner, HTTP Smuggler, Hackvertor, SAMLRaider, postMessage trackers, nowafpls family) | Hidden params, smuggling probes, encodings, SSO, message auditing, inspection-limit padding |
| interactsh / Burp Collaborator | OOB correlation with chain-required interpretation |
| takeover_scanner.sh (project) | Subdomain takeover fingerprints |
| arjun | Hidden parameter discovery on authenticated endpoints |
| GitDorker | Automated GitHub dork runs |
| keyhacks patterns | Provider-specific secret validation one-liners (use in-scope only) |
| hashid | Identify weak hash algorithms when dumps appear |

## Expected output if success

- Clear verdict: **submit**, **chain still needed**, **reject (always list)**, or **pivot tool/strategy**.
- Documented chain diagram for conditional classes before report.
- WAF obstacle resolved to reachable endpoint or abandoned with time-box note.
- Pattern-sorted URL subsets and wordlist category chosen for handoff to hunt skills.

## Expected output if not success

- Finding classified as N/A with matching rejection rule cited.
- WAF/rate-limit thread killed after bounded effort.
- No report based on DNS-only SSRF, introspection-only GraphQL, or version banner.

## Verification method

- Re-run the seven-question impact gate from **bug-bounty** / **triage-validation** if present in workspace.
- For conditional entries, demonstrate victim impact in one recording: credentialed cross-origin read, OAuth code on attacker redirect, etc.
- For WAF bypass claims, show stable non-block body on the sensitive endpoint—not a single flaky status.
- For framework CVE routes, capture version proof and in-scope execution or secret—not scanner template text alone.
- For leaked keys, use provider-appropriate **read-only** validation per keyhacks; revoked keys remain N/A.
- Include WAF/support log IDs in reports when extracted to speed vendor triage.
