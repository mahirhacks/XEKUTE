---
id: credential-attack
title: "Credential Exposure and Access Judgment"
description: "Defensive assessment playbook for exposed credentials, weak authentication posture, and proving whether leaked secrets actually grant in-scope access—without live password guessing or abuse of recovered accounts."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# Credential Exposure and Access Judgment

## What the skill is

A scope-first framework for reasoning about credentials as evidence: secrets in repositories, mobile binaries, CI logs, JavaScript bundles, and breach intelligence metadata. It covers when credential-related work belongs in an engagement, how to rank signal, what constitutes valid proof of access, and when to stop. It does not prescribe guessing passwords against login forms or operationalizing recovered usernames for authentication attacks.

## When to use

Load when recon or scanning surfaces API keys, tokens, connection strings, service account material, or employee-identifying data adjacent to authentication. Use when program policy must be interpreted for “secret exposure” vs prohibited “credential stuffing” or brute force. Use when triaging whether a leaked key is cosmetic, rate-limited, or fully privileged. Skip when policy forbids all authentication testing, when no secret or auth boundary is in play, or when the only next step would be spraying live logins.

## How to use

**Phase 0 — Policy and legal posture**

- Read rules for authentication testing, account lockout, employee OSINT, and use of breach corpora. Treat silent policy as restrictive; ask the program when wording is ambiguous.
- Do not use plaintext breach dumps or third-party “combo lists” to attempt logins; prefer k-anonymity breach prevalence checks on passwords you already hold legitimately (e.g. from the target’s own leaked test data in scope)—never as a login weapon.

**Phase 1 — Classify the artifact**

- Separate types: long-lived cloud keys, OAuth client secrets, session tokens, JWTs, database URLs, signing keys, and human-chosen passwords found in config.
- Note where each was found (repo commit, workflow log, mobile resource, public bucket, error message) and whether exposure is ongoing or historical.

**Phase 2 — Scope the identity and resource**

- Tie each secret to an in-scope hostname, cloud project, or API product named in the program.
- Ignore credentials that only affect vendor SDKs, analytics, or out-of-scope tenants unless impact clearly crosses into the target’s data.

**Phase 3 — Proof-of-access judgment (minimal and proportional)**

- For API keys and tokens: determine intended audience (server-only vs embeddable client key) and test with the least invasive call that demonstrates capability—read metadata, harmless list operation, or documented health endpoint—stopping before destructive or privacy-violating bulk export unless explicitly permitted.
- For repository or CI tokens: assess permissions implied by platform APIs (read vs write vs admin) using read-only inspection where allowed; do not push code or rotate secrets without approval.
- For human passwords found in config: treat as configuration defects; validating “works” may mean confirming the service accepts the pair in a single controlled session—not harvesting additional accounts.

**Phase 4 — Prevalence and prioritization (defensive analytics)**

- When ranking candidate passwords from the target’s own content for internal risk reporting, use breach prevalence statistics (hash-prefix services) to prefer likely human choices over random strings—without turning the list into a login campaign.
- Deprioritize ubiquitous passwords that appear in every automated scan; prioritize unique, company-shaped strings that indicate shared defaults or embedded service accounts.

**Phase 5 — OSINT boundaries**

- Employee emails and naming patterns may inform where secrets could apply (role accounts, staging admins) only when policy allows personnel-related collection; otherwise restrict to CT logs and hostnames feeding back into recon.
- Zero employee hits on mature targets is normal; subdomain and hostname discoveries still have recon value.

**Phase 6 — Stop and disclose**

- Stop after sufficient proof for severity; continuing to exercise a live secret beyond demonstration risks abuse findings and policy violations.
- If assessment activity may have triggered lockouts or rate limits, notify the program with timestamps and scope of tests.

**Phase 7 — Chain to higher-impact narrative (in scope)**

- A lone valid key is often informational unless it accesses regulated data, production infrastructure, or cross-tenant resources. Plan follow-up hunts (over-privileged IAM, IDOR on the API the key unlocks) using authenticated testing skills—without distributing the secret or logging into unrelated user accounts.

## Mental model

- **Presence ≠ impact:** Strings in a repo are triage signals until access is shown in scope.
- **Client-embeddable keys are designed to leak:** Impact requires bypass of referrer, IP, or role restrictions—not merely seeing the key.
- **Policy is part of the vuln surface:** An otherwise critical key tested out of scope is a compliance failure for the hunter, not a finding.
- **Breach data is intelligence, not ammunition:** Prevalence informs risk ratings; plaintext breach replay is out of bounds.
- **Service accounts scale damage:** Machine credentials often outlive employee passwords and lack MFA.
- **One proof is enough:** Extensive use of a recovered secret erodes trust with the program.

## Tools

| Tool | Job |
|------|-----|
| Secret scanners (gitleaks, trufflehog) | Discover committed or historical secrets for manual validation |
| Have I Been Pwned Pwned Passwords (k-anonymity) | Rank password strings by real-world prevalence without exfiltrating full hashes |
| HTTP client or API console | Execute minimal in-scope requests to judge key capabilities |
| Cloud provider read-only APIs | Enumerate effective permissions when keys are cloud-typed and testing is allowed |
| OSINT harvesters (theHarvester and similar) | Find hostnames and optionally corporate emails when policy permits |
| Site word harvesters (cewler and similar) | Build company-specific dictionaries for risk reporting—not for login spraying |
| Audit logs you maintain locally | Record what was tested, when, and under which scope interpretation |

## Expected output if success

- A classified inventory of exposed credentials with scope mapping and a clear access conclusion (none, limited, privileged).
- Minimal reproduction notes showing what resource was reachable and why that matters to the program.
- Severity tied to data or control obtained, not to the drama of the leak location alone.
- Recommended rotation and containment actions for the program.

## Expected output if not success

- Secrets are revoked, scoped to harmless public operations, or duplicated from documentation examples with no live effect.
- Keys hit only out-of-scope vendors or sandboxes with no path to production data.
- Policy forbids the only validation steps; document “likely valid” as hypothesis only and stop.
- Findings are default credentials on login portals where proof would require prohibited guessing—escalate as policy question, not exploit.

## Verification method

- Re-test from a clean environment with the same minimal call; confirm results are not cached artifacts or CDN errors.
- For cloud keys, cross-check IAM or equivalent policy attachments against what you observed—not assumed service names.
- Confirm the exposed material was not injected by your own tools or a fork; prefer commit history and third-party timestamps.
- Run the triage validation gate: realistic attacker, in-scope asset, demonstrated harm, no exclusive victim cooperation.
- When in doubt on authentication rules, obtain written program consent before any login attempt beyond single-pair config verification.
