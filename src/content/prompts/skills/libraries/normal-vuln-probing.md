# VAPT SKILL — Normal vulnerability probing

## 1. Purpose
Discriminate a specific hypothesis with **targeted, hypothesis-driven probes** across the standard OWASP/WSTG categories, moving from benign differentials to category-appropriate proof payloads, before any deep or exploit-grade testing.

## 2. Methodology
1. **Authorization (WSTG-ATHZ, WSTG-APIT, A01)** — Horizontal IDOR: same endpoint, swap object IDs across peer accounts. Vertical: low-privilege token on admin routes. Forced browsing: unlinked routes from Map/recon with each role. GraphQL/BOLA: field-level auth on queries and mutations.
2. **Session & auth (WSTG-ATHN, WSTG-SESS, A07)** — Session fixation, logout effectiveness, cookie flags, JWT alg/confusion (describe check only), MFA bypass paths, default credentials (if ROE permits).
3. **Injection (WSTG-INPV, A05)** — Identify parameter/header/cookie/JSON field → parser → sink. Benign differential first (quote, encoding, length) before exploit-grade payload. SQLi, XSS (reflected/stored), command, SSTI, SSRF — one hypothesis per sink.
4. **Configuration (WSTG-CONF, A02)** — Missing headers, debug modes, directory listing, backup files, CORS misconfiguration.
5. **Business logic (WSTG-BUSL, A06)** — Workflow order bypass, race on limited resources, price/quantity manipulation.

## 3. Tools that help
| Tool | How it helps |
|------|--------------|
| sqlmap | Automated SQLi detection (only when policy permits) |
| ffuf | Parameter fuzzing and route discovery |
| Custom HTTP / curl | Single-request manual replay for clarity |
| Browser devtools | Session, storage, and DOM inspection during manual tests |
| Proxy listener | Request capture and response diffing |

## 4. Output structure
Per-probe record: hypothesis ID, exact request variant, identity used, expected supporting/rejecting signal, actual observation, evidence ID. Per-hypothesis verdict: supporting | rejecting | inconclusive. Boundaries: no bulk probing without hypothesis; no destructive payloads unless exploit validation is explicitly enabled (deep-vuln-probing).
