---
id: xpath_injection
title: XPath injection
summary: Test XML-backed query inputs for altered selection semantics with bounded differential controls.
category: injection
level: standard
signals: ["xpath", "xml query", "filter", "search"]
technologies: ["xml", "soap"]
related: ["sqli", "xxe"]
---

## Workflow

Change one observed filter value, compare stable baseline/control behavior, and require repeatable unauthorized selection or authentication impact. Do not enumerate unrelated XML records.
