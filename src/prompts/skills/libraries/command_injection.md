---
id: command_injection
title: Command injection
summary: Test server inputs that invoke operating-system commands using benign, observable controls.
category: injection
level: advanced
signals: ["shell", "command", "ping", "converter", "process", "exec"]
technologies: ["web", "rest", "server"]
related: ["sqli", "server_template_injection", "deserialization"]
---

## Workflow

Only test an observed command-backed feature with explicit authorization. Establish a baseline, use a harmless deterministic marker, capture server-side evidence, and stop immediately after confirming or rejecting control. Never run destructive commands or access unrelated files.
