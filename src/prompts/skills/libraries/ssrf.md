---
id: ssrf
title: Server-side request forgery
summary: Test server-controlled URL fetches with an approved collaborator or harmless in-scope endpoint and strict egress limits.
category: server-side
level: standard
signals: ["url fetch", "webhook", "import", "preview", "callback", "proxy"]
technologies: ["web", "rest", "cloud", "url parser"]
related: ["advance_ssrf", "open_redirect", "host_header", "xxe"]
---

## Prerequisites

Identify an observed server-side fetch feature and an explicitly approved callback or in-scope endpoint. Do not probe metadata services, internal networks, or third-party systems without explicit authorization.

## Workflow

Compare a normal in-scope URL with a controlled harmless redirect/callback variant. Record whether the server resolves, follows, validates, or blocks the URL and which request evidence proves the server made the fetch. Test parser variants only when the application uses multiple URL representations.

## Verification rules

Require server-originated evidence and a clear trust-boundary violation. A client-side request or generic timeout is not SSRF proof. Stop after the minimum request that establishes reachability.
