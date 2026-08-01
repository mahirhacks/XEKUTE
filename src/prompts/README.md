# Prompts architecture

This directory groups every human-maintained layer that shapes XEKUTE's agent behavior:

```text
prompts/
|-- instructs/  # Text sent to models
|-- skills/     # Assessment workflows and decision knowledge
|-- rules/      # Declarative modes, policy defaults, and evidence states
`-- guardrail/  # Deterministic command, path, and data enforcement
```

Prompt wording can guide a model, but it cannot grant authority or bypass `rules/` and `guardrail/`. Runtime orchestration remains in `../agent/`.

## Where changes belong

- `instructs/system_prompt.js`: core role, evidence contract, operating loop, failure behavior, output expectations, and six mode overlays.
- `instructs/initial_prompt.js`: authority, project-profile, untrusted-context, and memory envelopes.
- `instructs/triage_prompt.js`: retry, verification, summary, and independent-verifier wording.
- `skills/context-router.js`: chooses conversational, workspace, or cyber context before discovery or tool exposure.
- `skills/cyber-library.js`: loads only the small specialist overlays relevant to the current cyber task.
- Other files under `skills/`: assessment phases, bug-bounty vocabulary, triage outcomes, and decision helpers.
- `rules/`: mode capabilities, evidence states, runtime-policy defaults, tool classification, and request-intent parsing.
- `guardrail/`: deterministic protected-path, command, and secret-redaction enforcement.

Keep model-facing prose in `instructs/`. Keep hard authorization and safety decisions out of prompts.
