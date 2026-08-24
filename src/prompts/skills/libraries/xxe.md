---
id: xxe
title: XML external entity processing
summary: Test XML parser external-entity and entity-expansion behavior using safe, approved controls.
category: injection
level: advanced
signals: ["xml", "doctype", "soap", "svg", "parser"]
technologies: ["xml", "soap", "saml", "svg"]
related: ["ssrf", "advance_ssrf", "file_upload"]
---

## Workflow

Identify XML parsing and use a harmless entity or parser-error control. Require server-side evidence of external resolution or unsafe expansion and stop before reading sensitive files or probing internal networks.
