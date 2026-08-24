---
id: client_template_injection
title: Client-side template injection
summary: Test whether user-controlled template expressions execute in a client rendering context.
category: client-side
level: advanced
signals: ["template", "expression", "render", "angular", "vue", "react"]
technologies: ["javascript", "spa", "templates"]
related: ["xss", "advance_xss"]
---

## Workflow

Identify the rendering engine and expression context from artifacts. Use a harmless arithmetic or inert marker control, compare encoded/rejected output, and verify execution only in a disposable authorized page.
