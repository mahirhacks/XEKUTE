---
id: open_redirect
title: Open redirect
summary: Test redirect destinations and allowlist/canonicalization rules for trusted navigation or chaining risk.
category: server-side
level: standard
signals: ["redirect", "return url", "next", "callback", "location"]
technologies: ["web", "oauth", "rest"]
related: ["ssrf", "advance_ssrf", "oauth_oidc_logic"]
---

## Workflow

Identify redirect parameters and compare approved, relative, encoded, and unapproved destinations. Confirm browser/server navigation and practical trust impact; do not chain into phishing or credential collection.
