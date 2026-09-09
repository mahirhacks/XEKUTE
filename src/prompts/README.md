# Prompts

Live model-facing harness. Prompt text cannot grant authority, expand scope, or authorize tools.

```text
prompts/
|-- instructions/   # Compiled system prompt + turn envelopes
|-- skills/         # Mode skills, request routing, vulnerability knowledge
`-- rules/          # Intent routing and evidence vocabulary
```

## Keep

- `instructions/system-prompt.js` — the only chat system prompt (Ask and Agent share it; mode overlays switch)
- `instructions/initial-context.js` — project settings, untrusted-context header, no-tools surface, mutation contract
- `skills/modes/agent-skill.js` and `ask-skill.js` — skill-context appended under the system prompt
- `skills/context-router.js` — chooses compact vs operational prompt depth
- `skills/libraries/*.md` — methodology knowledge for intelligence, not compiled into the system prompt
- `rules/` — request-intent and evidence vocabulary
- `../agent/runtime/verifier.js` — independent verifier system prompt (hidden hybrid-verifier call)

## Do not add here

- Retry/summary/verification prompt files (unused)
- Extra system-prompt sources
- Guardrail folders that only duplicate the MODEL GUIDANCE module
