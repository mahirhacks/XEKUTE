# VAPT SKILL — Header, token & CSRF analysis

## 1. Purpose
Audit HTTP request and response headers, cookie flags, and token handling for header-level vulnerabilities: missing or misconfigured security headers, weak CSRF protections, HTTP Parameter Pollution (HPP), and flawed authentication or anti-CSRF tokens.

## 2. Methodology
1. **Baseline capture** — Record all request/response headers and cookies for each in-scope route, method, and role. Missing headers are hypotheses, not findings.
2. **Security header audit** — CSP (WSTG-CONF-12), HSTS (WSTG-CONF-07), X-Frame-Options (WSTG-CLNT-01 clickjacking), X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CORP/COEP. Check policy strength, not just presence.
3. **Cookie flag audit** — Secure, HttpOnly, SameSite, Path on session and auth cookies; verify flags in the browser context, not just by reading the Set-Cookie header.
4. **CSRF analysis (WSTG-SESS-05)** — For every state-changing request (POST/PUT/DELETE): is a token required? Is it bound to the session, random, and validated server-side? Does the server reject missing or mismatched tokens? Are SameSite, Origin, or Referer checks used as backup? Is the token rotated on login/logout?
5. **Token analysis** — JWT: signature verification, alg confusion (none, HS256 using the public key), exp/nbf enforcement, kid header injection, claim tampering. Bearer tokens: sent in the Authorization header (never the URL), lifetime and rotation, revocation.
6. **HPP (WSTG-INPV)** — Send duplicate parameters (same name repeated), encoded variants (&, ;, %26, comma), and arrays (param[]); determine which value the framework keeps (first/last/joined). Test header-based parameters (X-Forwarded-For, X-Original-URL, Host) for routing and auth bypass.
7. **Differential testing** — Benign variant first; one hypothesis per check. Supporting signal: state change or behavior difference without a valid token or parameter. Rejecting signal: rejection or an identical response.
8. **Hypothesis linkage** — Each check answers one unknown and records expected vs actual observation before any verdict.

## 3. Tools that help
| Tool | How it helps |
|------|--------------|
| Security Inspector | Decode and analyze JWT claims, Base64 values, and header strings |
| Proxy listener / Intruder | Capture traffic and mutate headers, cookies, and parameters |
| curl | Raw request variants for header and token checks |
| ffuf | Parameter-pollution fuzzing with duplicate and encoded variants |
| Browser devtools | Inspect cookie flags, storage, and network headers in context |
| nuclei | Header and misconfiguration templates for broad coverage |

## 4. Output structure
Per check record: route, method, role, request variant, observed headers/cookies, expected vs actual, verdict (supporting | rejecting | inconclusive), evidence ID, and WSTG check id. Record missing headers and weak policies as hypotheses with claim state: inferred — never findings without a demonstrated impact. False positives: WAF or CDN-added headers, framework default headers, per-request token reissuance (normal), SameSite Lax on non-cross-site flows.
