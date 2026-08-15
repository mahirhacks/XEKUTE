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
- `skills/cyber-library.js`: loads only the small specialist overlays relevant to the current cyber task.
- Other files under `skills/`: assessment phases, bug-bounty vocabulary, triage outcomes, and decision helpers.
- `rules/`: prompt routing and evidence vocabulary.
- `guardrails/`: model guidance for data handling; deterministic scope enforcement lives in `../agent/authority/scope/`.

Keep model-facing prose in `instructions/`, `skills/`, and `guardrails/`. Keep hard scope decisions out of prompts.
