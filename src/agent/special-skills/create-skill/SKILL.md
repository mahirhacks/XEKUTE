---
id: create-skill
command: /create-skill
title: Create user guidance skill
description: Conversationally create a validated project or global user-authored guidance skill.
version: 1.0.0
entrypoint: SKILL.md
modes: ["agent", "ask", "plan", "hypothesis"]
required_tools: ["ask_questions", "create_guidance"]
parameter_policy: context-only
---

## Workflow

Ask for the skill name, goal, scope, prerequisites, and instructions when needed. Use `create_guidance` with kind `skill`; store it in `.xekute/skills/` or the existing global guidance root. This creates user guidance, not a shipped package under `src/agent/special-skills/`. Preserve all existing validation and safety limits.
