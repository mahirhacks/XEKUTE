---
id: triage-validation
title: "Triage and Validation"
description: "Pre-report quality gate—seven core questions, identity checks, four submission gates, reject lists, and chain rules before writing any platform report."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# Triage and Validation

## What the skill is

A disciplined filter between “interesting behavior” and “submittable finding.” It standardizes kill decisions, scope and impact checks, deduplication, severity alignment, and identity-aware reproduction so validity ratio and triager trust stay high.

## When to use

Immediately before drafting or submitting a report, when a scanner or code review suggests a bug, or when severity feels uncertain. One failed hard gate means stop—not a weaker report.

## How to use

**Seven-question gate (sequential; any hard fail → kill)**

1. **Immediate exploitability:** Can you describe setup, the exact request shape, observable result, real-world consequence, and cost to execute—without gaps? If the request cannot be stated concretely, kill.
2. **Program impact fit:** Does the outcome match the program’s accepted impact types and severities, and not an explicit exclusion? If excluded, kill.
3. **In-scope asset:** Vulnerable hostname, app, or repo is listed; production rules honored; not a vendor SaaS the customer merely uses. If out of scope, kill.
4. **Attacker-realistic privileges:** Finding is not “admin can admin” or requires implausible victim or physical access. Centralization-by-design admin behavior → kill on most programs.
5. **Novelty vs known behavior:** Hacktivity, issues, changelog, and docs do not already acknowledge it as fixed, duplicate, or intended. If intended, kill.
6. **Impact proof level:** Demonstrated harm beyond “technically possible.” Weak proof may downgrade severity; no victim-relevant data or action → do not submit as high impact.
7. **Invalid class check:** Not on the never-submit list unless a full chain is already proven end to end. If standalone invalid, kill.

**Identity extension (required for auth and access-control)**

Record which session found the issue; whether it reproduces anonymously; whether another user’s data or role boundary is actually crossed; whether expired sessions change the result. Misclassified “IDOR” that is only missing login, or shared visibility across peers, fails here—treat as unproven until identity matrix is complete.

**Four pre-submission gates (all must pass)**

- **Gate 0 — Reality (~30s):** Live reproduction, explicit scope check, repeatable from fresh session, evidence captured.
- **Gate 1 — Impact (~2m):** Clear attacker capability delta; real victim or organizational harm; no unlikely victim choreography.
- **Gate 2 — Deduplication (~5m):** Program disclosures, repo issues, recent reports, public search—not a known open issue.
- **Gate 3 — Report quality (~10m):** Title formula, reproducible steps, impact evidence (not status code alone), CVSS and program severity aligned, brief remediation; no hedging language that hides weak proof.

**Kill-fast heuristics**

- Cannot draft Q1 in five minutes → move on.
- More than two simultaneous attacker preconditions → kill.
- Nothing tangible for attacker to retain → kill.
- Documented design → kill.
- Thirty minutes on impact proof without reproducible demo → kill.

**Conditionally valid (chain first, then one report)**

Standalone low signals (open redirect, introspection-only GraphQL, DNS-only server fetch, wildcard CORS without credentialed data, rate limits on non-sensitive surfaces, self-only script context, host header alone, etc.) become valid only after you prove a chained outcome the program pays for (e.g. account compromise, sensitive exfil, supply-chain relevant write). Build and verify the chain before writing.

**Common N/A patterns (stop early)**

Match kill signals: execution blocked by policy with no session access; server fetch with callback but no internal content; object reference returning only own data; injection errors without sensitive rows; CORS without credentialed sensitive response; informational template matches; open redirect outside auth flows; admin-precondition “bugs.” Classify as informational and skip submission.

**Severity**

Use CVSS 3.1 consistently with demonstrated prerequisites and scope (network vs local, privileges, user interaction, confidentiality/integrity/availability). Score must match the narrative—not aspirational chain steps.

## Mental model

- **N/A damages reputation; informative is neutral; valid is earned.**
- **Triager lens:** Friday-evening skeptic—would they agree without charity?
- **One finding, one scenario:** Separate bugs get separate gate runs; do not bundle for one payout without clarity.
- **Proof layer ordering:** Live request beats code suspicion; cross-user beat same-user; data beat errors.

## Tools

| Tool | Job |
|------|-----|
| Program policy / scope page | Authoritative asset and exclusion list |
| Hacktivity / disclosed reports | Duplicate and pattern search |
| GitHub issue search | Known security discussions |
| CHANGELOG / release notes | Intended or fixed behavior |
| Proxy history / saved requests | Evidence and identity replay |
| audit.jsonl (session tags) | Tie findings to session identity hash |
| CVSS 3.1 calculator | Consistent severity vector |
| Validation command or checklist (`/validate`, `/triage`) | Structured gate execution |

## Expected output if success

- Completed gate worksheet: all seven yes, identity matrix filled for auth findings, four gates checked.
- Classification: submittable with agreed severity, or intentional downgrade with honest impact text.
- Report outline ready: title, impact paragraph, steps, evidence list, remediation line.

## Expected output if not success

- Explicit **kill** or **informational** label with reason (scope, duplicate, invalid class, weak proof, admin-centralization, chain incomplete).
- No platform draft; return to hunting or chain completion work only if a realistic connector remains.

## Verification method

- Re-run reproduction from clean browser or client with correct identity; attach response proof of sensitive data or unauthorized action.
- Confirm vulnerable URL and parameter names match scope document verbatim.
- For access control: demonstrate principal A obtains principal B’s object or action; confirm not public-by-design data.
- Second reviewer pass: read title and first sentence—impact obvious; no “could/may” without proof.
- Chain reports: each hop demonstrated in order; final harm matches single report narrative.
