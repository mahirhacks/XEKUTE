---
id: web2-vuln-classes
title: "Web2 Vulnerability Class Selection"
description: "Decision framework for choosing and prioritizing web vulnerability classes by preconditions, impact, and when to drop—load when routing recon leads or planning a focused hunt, not for exploit recipes."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# Web2 Vulnerability Class Selection

## What the skill is

A taxonomy and prioritization lens for roughly twenty-six common web bug classes—from object reference and access control through SSRF, business logic, AI/MCP surfaces, cache and transport issues, and supply chain. It explains **which class fits which signal**, what identity or setup you need, how severity scales with read vs write vs takeover, and when standalone signals are N/A. It does not teach step-by-step exploitation.

## When to use

Load after recon buckets exist, when choosing the next hunt thread, when a signal could map to multiple classes, or when triaging whether a partial behavior is reportable. Use **web2-recon** for surface; use **security-arsenal** for “never submit” and “chain required” gates. Load class-specific audit skills in this repo when you commit to one family.

## How to use

**Step 1 — Classify the lead**

- Map endpoint shape: numeric or opaque IDs, redirect parameters, file/path parameters, outbound URL fields, template-like reflections, upload handlers, GraphQL, WebSocket actions, SAML/OAuth callbacks, cacheable personalized URLs, encrypted cookies, multipart actions, package install hooks.
- Note **auth posture**: anonymous-only, single session, or two identities (horizontal/vertical). Some classes (IDOR, BOLA, mass assignment, GraphQL field auth, JWT logic, many MFA tests) require authenticated sessions; workflow-skip and some SAML probes intentionally stay unauthenticated.

**Step 2 — Estimate impact ceiling**

- Ask: read others’ data, modify others’ data, execute as server, steal account without victim cooperation, or affect all users via cache/smuggling?
- Prefer classes where your signal already implies **cross-tenant** or **privilege** harm over informational probes (DNS-only SSRF, introspection alone, prompt “misbehavior” without tool access).

**Step 3 — Check preconditions and drop early**

- Drop when program rules exclude the class, when only self-impact is possible, when duplicate saturation suggests no novel path, or when **security-arsenal** lists the standalone pattern as always rejected.
- Drop AI/LLM leads that do not chain to IDOR, exfil, tool misuse, or execution on another principal’s session or tenant.
- Drop deserialization/crypto leads without a demonstrated gadget path or verifiable oracle—magic bytes alone are recon, not a report.

**Step 4 — Pick one primary class per thread**

- Depth beats spraying: finish identity setup, sibling-endpoint review, and version/API comparison for that class before rotating.
- When stack hints exist (from recon), bias order but do not skip auth/logic classes on SPA-only stacks or API-only stacks on legacy monoliths.

**Step 5 — Plan verification before noise**

- Define what observable, in-scope proof looks like (cross-account data, forged session, internal service response, financial invariant broken)—not merely differential errors.

### Class routing reference (selection, not exploitation)

| Class cluster | Typical surface signals | Auth / setup | Impact ladder (higher = prioritize proof) | Drop when |
|---------------|-------------------------|--------------|-------------------------------------------|-----------|
| IDOR / BOLA | IDs in path, body, GraphQL `node`, WS user fields | Two users, diff tokens | Read PII → write → admin object → ATO path | Same-user only, public data, ID not honored server-side |
| Broken access control | Admin siblings missing middleware, client-only UI gates | Logged-in low priv + anon compare | Missing auth on destructive/export routes | Uniform 401/403, feature not in scope |
| XSS (reflected/stored/DOM) | Reflection, sinks in JS, rich text | Often any; victim for stored | Sensitive page / token theft chains | Self-only, CSP+no sink, no sensitive action |
| postMessage / DOM | `message` listeners without origin rigor | Victim session for impact | OAuth code / storage override chains | Strict origin equality, log-only handlers |
| SSRF | url/src/webhook/avatar fields, PDF/SVG fetchers | Sometimes login | Internal service → metadata → key exfil | DNS-only, no in-scope internal access proof |
| Business logic | Coupons, refunds, plan steps, negative quantities | User with credits | Money/credits invariant broken | Intended marketing behavior, no loss |
| Race / TOCTOU | Single-use codes, balances, stock | One or many sessions | Double spend, duplicate grant | Serialized server-side, idempotent design |
| SQLi | DB errors, search/filter | Context-dependent | Readable sensitive row > error alone | ORM-only with no raw sink found |
| OAuth / OIDC | redirect_uri, state, PKCE presence | Often anon for flow bugs | Code/token theft → ATO | Open redirect without token chain |
| File upload | Avatar, import, multipart APIs | User account | Stored XSS / exec only with allowed chain | Type enforced end-to-end, no execution path |
| GraphQL | `/graphql`, batching | User + introspection | Mutation/field auth bypass, node IDOR | Schema alone, no auth gap |
| LLM / AI / MCP | Chat, tools, RAG uploads | Cross-tenant setup for best bugs | Tool SSRF, file read, cross-user retrieval | Safety-only output, no privileged tool |
| API misconfig | Mass assign, JWT alg, CORS, prototype pollution | Bearer/cookie | Role escalation, cross-origin cred read | Wildcard without credentialed exfil |
| ATO taxonomy | Reset, email change, token reuse | Victim email access for some paths | No-click reset poison > click-through | Theoretical phishing only |
| SSTI | Names, PDFs, emails reflected in templates | User input surfaces | Confirmed evaluation → execution path | Math reflection in wrong engine only |
| Subdomain takeover | Dangling CNAME fingerprints | DNS recon | Cookie domain / OAuth redirect on subdomain | Provider not claimable, not in scope |
| Cloud / infra | Bucket names, Firebase, exposed panels | Often anon | Writable bucket, key in bundle | Listing without secrets |
| HTTP smuggling | CDN + origin, dual parsers | Advanced | Victim request capture, cache poison | No desync timing/behavior proof |
| Cache poison / deception | Personalized URLs, cache headers | Victim + cache hit | Mass user impact | Private cache only, no sensitive body |
| MFA bypass | OTP verify, step-up | Pre-MFA cookie | Skip step, rate limit, response trust | Rate limit + lockout effective |
| SAML / SSO | ACS endpoints, XML blobs | Mixed | Signature/wrapping → identity swap | Strict signature and single assertion processing |
| Error / debug | Actuator, profiler, debug flags | Often anon | Secrets in env/heap, session replay | Generic 500, version banner only |
| CSS injection | User CSS, email HTML, PDF render | Victim for exfil/click | Token exfil, sensitive click chain | No url/import, cosmetic only |
| LFI / inclusion | page/file/template params | Depends | Source with secrets > read-only passwd | readfile-only with no secret/exec chain |
| Deserialization | Cookies, blobs with typed wire formats | Context | OOB or output proving gadget | No gadget, patched libs |
| Dependency confusion | Internal package names in leaks | Registry policy | Callback from **target** CI/dev infra | Name public, lockfile pinned, no callback |
| Padding oracle / crypto misuse | Block-aligned cookies, ViewState | Anon or user | Forge session / admin blob | No differential oracle, read-only blob |

### Cheatsheet-aligned “try first” priorities (judgment order)

When the class is chosen but approach is unclear, prefer this **order of experiments** (conceptual—not payloads):

- **IDOR:** swap IDs across users; methods and API versions; GraphQL global IDs; WS fields.
- **XSS:** encoding context first; DOM sources (hash, referrer, messaging); stored in profile/tickets/metadata.
- **SSRF:** loopback and metadata only after confirming server-side fetch; escalate proof to internal content, not DNS alone.
- **Open redirect:** only pursue if OAuth or token chain is plausible.
- **SQLi:** errors and timing as hints; aim proof at one readable value or row, not blind noise.
- **OAuth:** redirect strictness, state, PKCE, implicit leakage.
- **Race:** parallel same-benefit requests on coupons, balances, limits.
- **Upload:** extension/MIME/parser differentials—not raw shell upload from this playbook.
- **Takeover:** CNAME to unclaimed provider; confirm program allows demonstration.
- **MFA:** step skip, response trust, reuse, rate limits on backup flows.

Always re-check: **/.git**, **.env**, **actuator**, **swagger**, **api version drift**, **WebSocket origin**, **smuggling on CDN hosts**—even on “quiet” targets (from consolidated methodology notes).

## Mental model

- **Class is a hypothesis; chain is the product.** Severity lives in what crosses a trust boundary, not the label.
- **Sibling rule:** If nine admin routes enforce auth, hunt the tenth export/delete/debug sibling.
- **Auth classes need identities.** One session tests features; two sessions test ownership.
- **AI/MCP:** Impact is tool invocation or cross-tenant retrieval, not rude model output.
- **Transport/cache classes** pay at scale; **logic classes** pay on money paths.
- **Version drift:** Older API versions and mobile backends often lag authorization fixes.

## Tools

| Tool | Job |
|------|-----|
| Burp Suite / ZAP | Proxy history, comparer, session handling |
| Auth session files / dual browsers | Cross-account replay |
| GraphQL clients | Schema exploration after policy check |
| WebSocket clients | Origin and subscription tests |
| Collaborator / interactsh | OOB correlation where class allows chained proof |
| Source from recon | Sink and auth grep when white-box |
| SAML tooling (e.g. SAMLRaider) | Structured SSO assertion review |
| PadBuster-class tools | Oracle confirmation only within program rules |
| phpggc / ysoserial (conceptual) | Gadget choice after sink confirmed—not first step |

## Expected output if success

- A chosen class with documented preconditions met (identities, endpoints, parameters).
- Clear impact statement: who loses what, without victim unrealistic steps.
- Lead upgraded to validation skill or report draft with chain articulated.
- Explicit “drop” decisions recorded for parallel classes that failed gates.

## Expected output if not success

- Class abandoned with reason: precondition missing, always-rejected standalone, no cross-user impact, or program exclusion.
- No report drafted on introspection-only, header-only, DNS-only SSRF, or unverified crypto oracle.
- Rotation note to next class from recon buckets.

## Verification method

- Reproduce with clean sessions; for IDOR/BOLA, show victim data or action under attacker token.
- Confirm fixes are not client-side only (repeat with direct API calls).
- Align proof with **security-arsenal** conditional-valid table—build end-to-end chain before filing.
- For AI/supply chain: verify callback or execution originates from target-owned infrastructure per policy.
- Scope re-check on every demonstrated hostname and data record.
