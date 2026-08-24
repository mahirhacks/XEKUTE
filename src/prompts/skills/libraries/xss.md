---
id: xss
title: Cross-site scripting
summary: Test reflected, stored, and context-specific output encoding with benign, uniquely attributable markers.
category: client-side
level: standard
signals: ["html sink", "script sink", "template", "reflection", "comment", "attribute"]
technologies: ["web", "javascript", "templates", "markdown"]
related: ["advance_xss", "dom_xss", "client_template_injection", "csrf"]
---

## Prerequisites

Identify input sources, output contexts, encoding layers, CSP, sanitizers, and a safe browser observation path. Use a unique inert marker before any context-specific proof.

## Workflow

1. Send one benign marker through each observed input source and locate exact reflection/storage context.
2. Classify HTML text, attribute, URL, JavaScript, CSS, template, Markdown, SVG, and DOM sinks.
3. Compare encoded, rejected, normalized, and stored results with a harmless negative control.
4. Verify execution only in the authorized browser context and stop once the security property is established.
5. For stored content, confirm persistence, viewers affected, role/tenant boundaries, and cleanup.

## Evidence

Capture source, sink, context, redacted input reference, response or DOM evidence, CSP/sanitizer behavior, affected roles, and cleanup. Never collect cookies or unrelated user data.

## Verification rules

Reflection alone is not execution. Confirm that the browser interprets attacker-controlled data in the relevant context and distinguish self-XSS or editor-only behavior from an exploitable boundary.
