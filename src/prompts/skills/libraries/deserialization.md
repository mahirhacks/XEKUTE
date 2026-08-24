---
id: deserialization
title: Unsafe deserialization
summary: Test serialized input handling for type confusion, integrity bypass, or unsafe object construction without executing harmful payloads.
category: injection
level: advanced
signals: ["serialized", "object", "pickle", "java", "type", "cookie"]
technologies: ["java", ".net", "php", "python", "web"]
related: ["command_injection", "auth_logic"]
---

## Workflow

Identify serialization format and integrity controls from traffic or artifacts. Use harmless type and integrity differentials, preserve parser errors, and stop before code execution or data access.
