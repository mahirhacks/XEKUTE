# XEKUTE runtime flow

An agent turn follows this sequence:

```text
renderer prompt
  -> preload IPC
  -> app agent handler
  -> controller: normalize mode and select prompt context
  -> deterministic workflow router: ordinary/evidence/hypothesis/plan/approval/execution intent
  -> prompt compiler: system -> mode -> specialist -> project-status chunk -> memory -> user -> tools
  -> provider stream
  -> runtime parser/runner
  -> mode surface check
  -> approved-plan action/evidence constraint check when bound
  -> authority profile resolver
  -> validation/scope/lists/identity/risk/policy/approval
  -> environment/resource/concurrency/timeout assignment
  -> execution monitor wraps raw tool adapter
  -> output control/verification/recovery/rollback/audit
  -> result/evidence projection
  -> provider continuation or lifecycle completion
  -> renderer events + session-memory block updates
```

The first non-empty prompt lazily creates a durable session and block. Tool
starts, questions, answers, assistant output, partial output, stops, failures,
and completion metadata are written incrementally. Empty chats remain renderer
state only.

Malformed-call suppression and duplicate-failure protection remain operational
runtime behavior. Multi-day runs have no default wall-clock, workflow, or model
round deadline. Commands may opt into explicit deadlines. Long operations use
durable detached process records, output cursors, cancellable observation
windows, progress heartbeats, atomic run checkpoints with backup recovery, and
restart reconciliation. MCP startup uses a bounded handshake, while MCP tool
calls have no default lifetime and forward protocol progress into the same
monitor. Explicit operation deadlines and operator cancellation still apply.

When an active turn grows beyond its model working-set budget, XEKUTE creates a
deterministic model-only action ledger and bounded recent tail. The full UI and
durable session transcript are not changed or deleted. The ledger retains
aggregate outcomes, failure classes, process IDs, evidence references, and
recent targets so a seven-day run can continue without repeatedly feeding raw
scan output to the model.

Authority events are appended to a redacted SHA-256 hash chain under the
workspace. The chain verifier reports the first modified or malformed record;
secrets are never required to verify audit integrity.

Scope failures are structured results containing a stable code, explanation,
and remediation text. They are returned to the model as tool results so the
assistant can explain them normally.

Assessment intelligence is local and rebuildable. Raw project artifacts remain
the source of truth; the worker-backed SQLite index stores bounded sanitized
projections. Hypothesis retrieval reads project evidence, Plan retrieval reads
assessment methodology, and plan-bound Agent runs can inspect declared or
run-produced evidence without gaining new executable actions.
