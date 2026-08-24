---
id: dom_xss
title: DOM-based XSS
summary: Trace client-controlled sources into browser DOM or script sinks with a bounded browser proof.
category: client-side
level: advanced
signals: ["location", "hash", "postmessage", "innerhtml", "eval", "dom sink"]
technologies: ["javascript", "spa", "browser"]
advance_of: xss
related: ["advance_xss", "client_template_injection"]
---

## Workflow

Use artifact analysis to identify sources and sinks, then send a unique inert marker through one source. Confirm context and execution in the authorized browser with a negative control; do not collect credentials or persist beyond cleanup.
