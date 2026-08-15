# Agent memory

This folder owns bounded, structured memory used while composing and
continuing agent turns. `context-memory.js` selects context, `failure-memory.js`
tracks repeated failures, `action-memory.js` records redacted operational events,
and `evidence-memory.js` contains evidence, hypothesis, observation, and verification
record contracts. Durable encrypted project/session memory belongs in
`src/app/storage`, not here.
