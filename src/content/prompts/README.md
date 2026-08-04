# XEKUTE prompt authoring

This is the **human-editable source of truth** for model-facing prompt prose. Prose lives here as raw
Markdown (`.md`); a builder regenerates the exact `.js` modules the app consumes.

```text
src/prompt/
|-- prompt_builder.js            # reads .md -> regenerates src/prompts/**/*.js
|-- instructs/                   # system prompt (structure + prose)
|-- skills/
|   |-- modes/                   # mode skill files (## TESTING / ## ASSIST)
|   `-- libraries/               # VAPT phase skill libraries (whole-file prose)
|-- rules/                       # (logic only, not generated — see README)
`-- guardrails/                  # (logic only, not generated — see README)
```

## How to edit

1. Edit the `.md` files under `src/prompt/`.
2. Regenerate the consumed `.js` modules:

   ```bash
   node src/prompt/prompt_builder.js
   ```

3. The app load path is unchanged: the builder writes to `src/prompts/**`, which the
   Node agent (`require`) and the renderer (script tags) already read. Behavior, browser
   loading, and tests are identical.

## What becomes `.md`

| Kind | Example | Outcome |
|------|---------|---------|
| Structure + prose | `instructs/system_prompt.md` | regenerates `instructs/system_prompt.js` |
| Mode skill prose | `skills/modes/agent-skill.md` | regenerates `skills/modes/agent-skill.js` |
| Phase library prose | `skills/libraries/recon-active.md` | regenerates `skills/libraries/recon-active.js` |

## What stays hand-written `.js`

`src/prompts/rules/**` and `src/prompts/guardrail/**` contain **runtime logic** — regexes,
state machines, and deterministic enforcement — not editable prose. They are not generated here.
The `src/prompt/rules/` and `src/prompt/guardrails/` folders hold a README documenting that
choice, not generated content.

## Grammar

- **Library files**: the entire file body (minus a single trailing newline) becomes the string.
- **Mode files**: `## TESTING` and `## ASSIST` headings delimit the two exported strings.
- **System prompt**: see `instructs/system_prompt.md` — frontmatter scalars, `# BLOCK_NAME`
  string blocks, `# OBJECT_NAME` object blocks, and `# MODULE <name>` module blocks.

> Never edit the generated `src/prompts/**` `.js` files directly — they are overwritten.
