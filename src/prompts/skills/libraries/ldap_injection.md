---
id: ldap_injection
title: LDAP injection
summary: Test directory search or authentication inputs for unintended filter semantics.
category: injection
level: standard
signals: ["ldap", "directory", "filter", "user search"]
technologies: ["ldap", "identity"]
related: ["sqli", "auth_logic"]
---

## Workflow

Use a controlled directory account and compare literal, escaped, and invalid filter behavior. Require evidence of changed authorization or search scope rather than a generic directory error.
