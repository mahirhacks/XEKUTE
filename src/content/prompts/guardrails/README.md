# guardrails/ — logic only

The canonical guardrails live in `src/prompts/guardrail/` as hand-written JavaScript because
they are **deterministic enforcement** (secret redaction, protected-path regexes, command
blocking), not editable model-facing prose:

- `command-guardrails.js` — protected-path + destructive-command blocking.
- `data-guardrails.js` — deterministic secret redaction.

These are consumed via `require` by the Node agent and must remain exact, so they stay `.js`.
Edit them directly.

For pure prose that shapes model behavior, use the Markdown sources under the parent tree
(`instructs/`, `skills/`) and run `prompt_builder.js`.
