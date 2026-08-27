---
id: create-subagent
title: Create a subagent profile
description: Internal guidance for conversationally creating a validated project or global XEKUTE subagent profile.
version: 1.1.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask", "plan", "hypothesis"]
required_tools: ["ask_questions", "create_guidance"]
parameter_policy: context-only
---

## Workflow

Ask for the subagent name, role, allowed scope, tools, and constraints when needed. Use `create_guidance` with kind `subagent`; store it in `.xekute/subagents/` or the existing global guidance root. The subagent must not expand its parent's authority, scope, identity, resources, or approval state.
