# rules/ — logic only

The canonical `rules` for mode/authority/policy live in `src/prompts/rules/` as hand-written
JavaScript because they are **runtime logic** (mode profiles, regexes, state machines,
deterministic defaults), not editable model-facing prose:

- `operating-mode-rules.js` — flat mode profiles + alias normalization.
- `evidence-rules.js` — allowed lifecycle states (`CLAIM_STATES`, `VERDICTS`, ...).
- `runtime-policy-rules.js` — policy defaults + command/action classification regexes.
- `request-intent-rules.js` — deterministic request-intent parsing.

These are consumed via `require` by the Node agent and via script tags by the renderer for
real enforcement, so they stay `.js`. Edit them directly.

For pure prose that shapes model behavior, use the Markdown sources under the parent tree
(`instructs/`, `skills/`) and run `prompt_builder.js`.
