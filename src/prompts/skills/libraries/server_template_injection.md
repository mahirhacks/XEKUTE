---
id: server_template_injection
title: Server-side template injection
summary: Test template expression handling in server-rendered input with harmless arithmetic controls.
category: injection
level: advanced
signals: ["template", "render", "expression", "server-side", "preview"]
technologies: ["jinja", "freemarker", "handlebars", "server templates"]
related: ["xss", "command_injection", "sqli"]
---

## Workflow

Locate server rendering and use one harmless expression/control. Compare literal, encoded, and evaluated output, preserve renderer/version evidence, and stop once the server-side evaluation property is established.
