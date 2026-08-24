---
id: create-rule
command: /create-rule
title: Create a project rule
description: Conversationally create a validated project or global XEKUTE rule.
version: 1.0.0
entrypoint: SKILL.md
modes: ["agent", "ask", "plan", "hypothesis"]
required_tools: ["ask_questions", "create_guidance"]
parameter_policy: context-only
---

## Workflow

Ask for the rule name, purpose, scope, and exact guidance when needed. Use `create_guidance` with kind `rule`; retain the existing path, size, duplicate, symlink, and scope protections. Store project rules under `.xekute/rules/` or global rules in the existing global guidance root. Do not write application source files.
