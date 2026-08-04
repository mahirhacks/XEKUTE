# VAPT SKILL — Automated security scanning

## 1. Purpose
Use scanners to generate **leads** across many checks quickly — never as final findings without verification. Automated scanning broadens coverage of configuration, injection, and crypto categories to feed the hypothesis queue.

## 2. Methodology
1. **Objective** — Which WSTG category gap does this wave address?
2. **Target list** — In-scope URLs/hosts only; dedupe from recon output.
3. **Template set** — Tag-specific nuclei templates; exclude intrusive templates unless exploit validation is allowed.
4. **Rate limits** — Set requests/sec, parallelism, and max hosts per wave from ROE.
5. **Baseline** — Run against a known-safe path or staging when available for false-positive comparison.
6. **Output** — Save raw scan file path, parser for evidence ingest, and checklist ID tagging.
7. **Lead → hypothesis promotion** — Scanner hit becomes a hypothesis with: template ID, matched URL, response snippet, claim state: inferred. Promotion requires vuln-probing or verification workflow — never automatic.

## 3. Tools that help
| Tool | How it helps |
|------|--------------|
| nuclei | Template-based misconfiguration and vulnerability signatures (CONF, INPV, CRYP, A02, A05) |
| nikto | Web server misconfiguration (CONF, ERRH) |
| nmap | Service/version detection, scripted cautiously (INFO, CONF) |
| testssl | TLS configuration checks (CRYP, A04) |
| httpx | Surface validation at scale (INFO) |

## 4. Output structure
Record per wave: objective, target list, template set, rate limits, baseline reference, raw scan file path, and each promoted lead as hypothesis {template ID, matched URL, response snippet, claim state: inferred}. Plan for false positives: WAF blocks, CDN caching, generic CVE templates on patched versions, reflected input in error pages, self-XSS. Stop conditions: abort wave on service errors, scan-induced blocking, or scope redirect to out-of-scope host.
