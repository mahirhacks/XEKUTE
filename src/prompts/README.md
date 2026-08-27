# Prompts architecture

This directory groups every human-maintained layer that shapes XEKUTE's agent behavior:

```text
prompts/
|-- instructions/ # Canonical model-facing instructions
|-- skills/     # Assessment workflows and decision knowledge
|-- rules/      # Prompt routing and evidence vocabulary
`-- guardrails/ # Model-facing safety and data-handling guidance
```

Prompt wording can guide a model, but it cannot grant authority, expand scope, or authorize tool execution. Runtime orchestration remains in `../agent/`.

## Where changes belong

- `instructions/system-prompt.js`: the sole global system instruction source.
- `instructions/initial-context.js`: project-profile, untrusted-context, memory, and tool envelopes.
- `instructions/triage.js`: retry, verification, summary, and independent-verifier wording.
- `skills/context-router.js`: chooses conversational, workspace, or cyber context before discovery or tool exposure.
- `skills/libraries/*.md`: Markdown-first vulnerability knowledge with compact metadata and source-linked techniques.
- `../agent/special-skills/`: internal Markdown workflow packages selected from ordinary intent or explicit system-skill commands. The picker exposes only safe invocation metadata; package instructions remain internal and run beneath `instructions/system-prompt.js`.
- Other files under `skills/`: context routing, mode overlays, triage outcomes, and decision helpers.
- `rules/`: prompt routing and evidence vocabulary.
- `guardrails/`: model guidance for data handling; deterministic scope enforcement lives in `../agent/authority/scope/`.

Keep model-facing prose in `instructions/`, `skills/`, and `guardrails/`. Keep hard scope decisions out of prompts.
