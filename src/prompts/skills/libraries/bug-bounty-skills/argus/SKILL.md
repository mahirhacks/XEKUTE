---
id: argus
title: "Argus Scanner Suite"
description: "Routed web and LLM security scanning when a target exposes APIs, JWT auth, injectable parameters, blind server-side behavior, or chatbot features and you need fast class-specific signal plus out-of-band proof for invisible bugs."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# Argus Scanner Suite

## What the skill is

Argus is a six-module, Python-based scanner suite that surfaces high-yield web2 and LLM issue classes with minimal setup. Each module targets one failure family: cross-origin trust mistakes, header and host injection, document-store auth logic, JWT trust mistakes, blind vulnerability confirmation via out-of-band callbacks, and categorized LLM abuse probes. Core logic is designed to be testable offline; live runs need network and program authorization.

## When to use

Load Argus when recon shows JSON APIs, cookie or bearer sessions, login bodies, redirect or log parameters, JWTs in headers or storage, suspected blind SSRF/XXE/SQLi/RCE with no visible response delta, or customer-facing chatbots and agents. Route to one module per signal rather than running everything blindly—see routing below.

**Routing signals**

| What you observe | Module |
|------------------|--------|
| `Access-Control-*` headers or reflected `Origin` on API responses | CORS scanner |
| User input influencing redirects, response headers, or logs | CRLF / host-header scanner |
| JSON login or query APIs on Mongo-style stacks | NoSQL injection scanner |
| Bearer JWT or session JWT in cookies | JWT scanner (offline analyze and forge checks) |
| Blind server-side fetch, parse, or query with no in-band proof | OOB listener and correlator |
| Chat or completion endpoints | LLM red-team runner |

## How to use

**Phase 0 — Authorization and session realism**

- Confirm the endpoint is in scope and testing is permitted.
- For credentialed CORS and authenticated LLM runs, supply a realistic session or bearer token so results reflect production trust, not anonymous preflight-only behavior.

**Phase 1 — Pick the module**

- Match the highest-confidence signal from routing; avoid parallel noisy scans on unrelated hosts.
- For login surfaces, establish a wrong-credential baseline before interpreting status or body deltas.

**Phase 2 — Run and classify**

- **CORS:** Probe crafted origins; classify reflected origin with credentials, null-origin trust, and subdomain or suffix bypass patterns. Treat credentialed cross-origin read as highest severity when cookies authenticate the API.
- **CRLF / host:** Exercise encoded header injection and forwarded-host variants; look for attacker-controlled hosts in `Location` or injected response headers. Remember URL libraries may normalize raw newlines—encoded forms matter.
- **NoSQL:** Exercise operator-style auth bypass and bracket-encoded bodies; watch for status flips, large body changes, or time delays on server-evaluated predicates—treat server-side JS evaluation as critical when confirmed.
- **JWT:** Analyze algorithm choice, expiry, sensitive claims, and `kid` handling; test none-algorithm acceptance, asymmetric-to-symmetric confusion with the published public key, and weak shared-secret guessing. Validate forged tokens only against an in-scope authenticated endpoint.
- **OOB:** Start a listener, generate per-injection-point markers, fire blind payloads from manual or other tooling, then correlate callbacks to markers. Use this to upgrade “maybe blind” to reportable when policy allows OOB testing.
- **LLM red-team:** Send categorized probes (injection, jailbreak, system prompt leak, exfiltration, indirect injection, guardrail bypass) with a unique canary token in responses to detect subtle hits; escalate only when chained impact (data access, account actions, tool use) is demonstrable.

**Phase 3 — Chain thinking (reporting, not spraying)**

- Note composition: credentialed CORS plus session metadata can enable account actions; forged JWT plus admin routes enables authorization sweeps; confirmed blind SSRF toward cloud metadata is a severity multiplier; LLM leaks or tool misuse may pair with IDOR on conversation APIs.
- Stop at module severity when impact is informational until a second step proves harm in scope.

**Phase 4 — Hand off**

- Export JSON or logs where supported; attach raw request/response pairs for manual findings.
- Route confirmed web classes to broader methodology skills; route LLM hits to agentic-AI threat framing when building the final narrative.

## Mental model

- **One eye per class:** Argus is not a megascanner; routing contains noise.
- **Blind needs correlation:** Without OOB proof, many server-side bugs stay hypotheses.
- **Cookies change CORS:** Anonymous preflight results understate credentialed API risk.
- **JWT trust is offline-first:** Cryptographic mistakes are cheap to test before network replay.
- **LLM hits are leads:** A jailbreak string alone is rarely the final severity—look for data, tools, or identity boundaries.
- **Encoded versus raw:** Header and CRLF testing must respect what actually reaches the server.

## Tools

| Tool | Job |
|------|-----|
| cors_scanner.py | Origin reflection, credential flags, and bypass classification on API URLs |
| crlf_scanner.py | CRLF and host / forwarded-host injection on parameters and redirects |
| nosqli_scanner.py | JSON and query NoSQL auth-bypass and timing signals on login or query endpoints |
| jwt_scanner.py | Offline JWT analysis, algorithm confusion checks, and weak-secret trials |
| oob_listener.py | OOB domain lifecycle: listen, payload markers, callback correlation |
| llm_redteam.py | Categorized prompt corpus against chat endpoints with canary-based detection |
| interactsh-client (external) | Live OOB DNS/HTTP callback infrastructure when in-scope |

## Expected output if success

- Per-module severity label with the minimal evidence chain (request shape, header set, response delta, or callback ID).
- For OOB: correlated marker proving which injection point triggered an external interaction.
- For JWT: forged or altered token that an in-scope protected endpoint accepts, with claim diff documented.
- For LLM: category hit with canary or policy-violating content plus notes on plausible escalation paths.
- Structured JSON or log output suitable for triage gates and report drafting.

## Expected output if not success

- Clean module run with baseline comparison documented (e.g., login still fails on bypass bodies).
- Inconclusive blind tests without callbacks—recorded as “unproven,” not false negatives filed as positives.
- Scanner errors (auth required, WAF block, rate limit) as stop conditions with retry guidance, not overstated findings.
- Informational LLM outputs without canary or sensitive data—logged as recon, not Critical.

## Verification method

- Reproduce the winning request with a fresh session; exclude cached CDN or stale cookies.
- For CORS, demonstrate read of non-public data cross-origin only when program rules allow and impact is user-specific.
- For JWT acceptance bugs, show before/after authorization on the same endpoint with identical routes except token.
- For OOB, match callback timestamp and marker to a single injected parameter instance; rule out scanner self-requests.
- For NoSQL timing, repeat delays with control payloads to reduce network jitter false positives.
- For LLM issues, confirm the sensitive content or canary appeared in the application-visible channel (not only stderr logs out of scope).
- Downgrade or discard if another explanation (generic error page, length padding, bot wall) fits the signal equally well.
