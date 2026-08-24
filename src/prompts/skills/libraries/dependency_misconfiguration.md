---
id: dependency_misconfiguration
title: Dependency and platform misconfiguration
summary: Correlate versions, defaults, exposed services, debug settings, and deployment configuration with observed risk.
category: platform
level: standard
signals: ["version", "debug", "default", "dependency", "service", "config"]
technologies: ["web", "server", "cloud"]
related: ["security_headers", "sensitive_data_exposure", "ssrf"]
---

## Workflow

Treat fingerprinting as a lead. Confirm configuration and affected behavior through approved evidence, scope, and minimal safe checks. Record version confidence and do not claim a CVE without a matching vulnerable condition.
