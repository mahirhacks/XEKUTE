---
id: advance_ssrf
title: Advanced SSRF and egress-control analysis
summary: Extend SSRF analysis across redirects, parser differentials, DNS rebinding indicators, and cloud/service boundaries without unsafe probing.
category: server-side
level: advanced
signals: ["redirect", "dns", "url parser", "allowlist", "egress", "cloud"]
technologies: ["web", "cloud", "proxy", "url parser"]
advance_of: ssrf
related: ["xxe", "host_header", "open_redirect", "request_smuggling"]
---

## Techniques

- Compare canonicalization across scheme, host, port, credentials, redirects, encoded separators, and DNS resolution where the observed parser supports them.
- Verify allowlist checks at every redirect and service boundary.
- Use an approved collaborator or in-scope controlled endpoint to distinguish server fetch from client navigation.
- Record DNS/HTTP timing and response provenance without querying sensitive internal services.

## Verification rules

Advanced classification requires repeatable evidence of a server-side trust-boundary bypass. Do not access cloud metadata, internal admin panels, or unrelated systems unless the signed scope explicitly permits it.
