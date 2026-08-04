# VAPT SKILL — Passive recon (WSTG-INFO)

## 1. Purpose
Build an evidence-backed picture of the target using passive and low-impact sources before any active probing. Passive recon discovers the attack surface, entry points, and technology stack without touching the target directly.

## 2. Methodology
1. **Public archives & search engines** — WSTG-INFO-01: search-engine and public archive reconnaissance.
2. **Metafiles** — WSTG-INFO-03: robots.txt, sitemap.xml, security.txt, .well-known.
3. **Attack surface enumeration** — WSTG-INFO-04: subdomains, APIs, and admin paths from public data.
4. **Content review** — WSTG-INFO-05: comments, JS bundles, HTML, and PDF metadata for leakage.
5. **Entry point mapping** — WSTG-INFO-06: forms, APIs, upload points, WebSockets.
6. **Fingerprinting** — WSTG-INFO-08/09/10: framework, platform, application, and architecture (tiers, CDNs, WAF) from headers, TLS, and error pages.

## 3. Tools that help
| Tool | How it helps |
|------|--------------|
| Subfinder / Amass (passive) | Enumerate subdomains from certificate transparency and DNS history |
| Certificate transparency logs | Discover hosts, API subdomains, and legacy infrastructure |
| Browser devtools / Map | Review routes, parameters, auth patterns, and third-party scripts |
| httpx (passive mode) | Probe discovered hosts for status, title, and tech fingerprints |
| Public repo / paste / breach-index review | Scope-only, legal leakage review for credentials or internal hints |

## 4. Output structure
For each inventory item record: source used, artifact collected, URL/timestamp, raw HTTP excerpt or screenshot reference, WSTG-INFO check id, and limitation if the source was unavailable. Anti-patterns: do not treat search-engine snippets as verified facts; do not expand scope from discovered subdomains without a scope rule match.
