---
id: advance_xss
title: Advanced XSS and client-side trust analysis
summary: Trace multi-step, DOM, template, postMessage, and policy interactions that can turn controlled input into script execution.
category: client-side
level: advanced
signals: ["dom sink", "postmessage", "template", "innerhtml", "csp", "sanitizer"]
technologies: ["javascript", "spa", "webview", "websocket"]
advance_of: xss
related: ["dom_xss", "client_template_injection", "csrf", "cors"]
---

## Techniques

- Trace source-to-sink flows across URL fragments, history state, storage, messages, WebSockets, and downloaded configuration.
- Test parser differentials between server sanitization, browser parsing, framework hydration, and client-side templating.
- Review postMessage origin checks, sandbox transitions, iframe boundaries, and trusted-type/CSP enforcement.
- Compare encoded and normalized variants only where the application evidence indicates a parser boundary.
- Assess stored delivery paths, privileged viewers, preview/export modes, and cross-tenant rendering.

## Verification rules

Demonstrate the exact source, sink, execution context, affected principal, and policy boundary. Do not classify a blocked payload or static sink reference as a finding.
