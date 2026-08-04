# VAPT SKILL — Soft vulnerability probing

## 1. Purpose
Discriminate a hypothesis with **minimal, low-impact, reversible** probes before any exploit-grade payload is considered. Soft probing confirms whether a signal is worth deeper testing without risking service degradation or data corruption.

## 2. Methodology
1. **Entry conditions** — Require scoped target, hypothesis with supporting/rejecting signals, test-design phase complete, approval if required.
2. **Benign differential first** — Quote, encoding, and length variations before any payload; observe parser behavior.
3. **Configuration checks** — Missing headers, debug modes, directory listing, backup files, CORS misconfiguration.
4. **Session & auth hygiene** — Cookie flags, logout effectiveness, password-reset token reuse (describe check only).
5. **Single-request replay** — Prefer one manual request per hypothesis for clarity over bulk probing.
6. **Per-probe documentation** — Record hypothesis ID, exact request variant, identity used, expected supporting/rejecting signal, actual observation, evidence ID.

## 3. Tools that help
| Tool | How it helps |
|------|--------------|
| Custom HTTP / curl | Precise single-request variants with full control |
| Browser devtools / Map | Parameter, header, and cookie inspection without payloads |
| ffuf (benign wordlists) | Enumeration of parameters and endpoints with small lists |
| Proxy listener | Capture and diff request/response pairs |

## 4. Output structure
For each probe record: hypothesis ID, request variant, identity used, expected vs actual observation, evidence ID, and verdict (supporting | rejecting | inconclusive). Boundaries: no bulk probing without a hypothesis; no destructive or exploit-grade payloads in this stage — those belong to normal/deep probing only.
