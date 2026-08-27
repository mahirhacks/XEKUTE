# Xekute Context Memory v2 — Acceptance Matrix

Each scenario is a release-gate scenario. The listed implementation suites are the first diagnostic location; the Phase O gate also runs the complete regression and production verification commands.

| ID | Scenario | Required outcome | Diagnostic suites |
| --- | --- | --- | --- |
| O-01 | Fresh project, empty reads | No memory directory or manifest is scaffolded; reads return an empty state | `memory-durability`, `memory-ipc` |
| O-02 | First accepted semantic write | Protected project ID and lazy manifest are created exactly once | `memory-durability`, `project-memory-v2` |
| O-03 | Workspace move/rename | The same `proj_` ID, aliases, records, and references remain valid | `memory-durability`, `project-profile` |
| O-04 | Long tool loop | Hundreds of internal actions produce one terminal semantic finalization | `execution-capture`, `block-memory-updater`, `block-reducer-finalizer` |
| O-05 | No-new-fact block | Project revision does not change, while Investigation attempts/coverage may advance once | `investigation-service`, `block-memory-updater` |
| O-06 | Candidate vulnerability | Candidate remains in Investigation until a verifier accepts it | `investigation-memory`, `evidence-service`, `verify-finding` |
| O-07 | Confirmed vulnerability | Evidence stores proof-linked low–critical finding with verification history, impact, remediation, and retest state | `evidence-memory`, `evidence-repository`, `evidence-service` |
| O-08 | Crash during promotion | Outbox recovery produces one Investigation outcome and one Evidence finding | `evidence-service`, `memory-durability` |
| O-09 | Authenticated rotation | Same-block later requests use rotated cookies/tokens; semantic outputs contain mechanisms and handles only | `sensitive-working-memory`, `replay-request`, `browser-session-manager` |
| O-10 | mTLS | Client chain/passphrase capability works through the adapter; private key never reaches model context | `identity-vault`, `sensitive-working-memory` |
| O-11 | Session compression | Exact transcript hash is unchanged; synopsis, ledger, tail, refs, revisions, and pending gaps are atomic | `context-checkpoint-service`, `context-summarizer`, `operational-context-store` |
| O-12 | Pending predecessor finalization | Context Assembly waits no longer than 250 ms and exposes `memory_finalization_pending` | `context-assembly`, `memory-status` |
| O-13 | Corrupted derived index | SQLite/graph rebuild from canonical records gives equivalent bounded query results | `derived-memory-index`, `memory-graph-view`, `memory-graph-store` |
| O-14 | Legacy-heavy migration | Preview is read-only; import is additive/idempotent; no candidate or informational record enters Evidence | `memory-migration`, `chat-memory-migration` |
| O-15 | Malicious stored content | Stored instructions cannot expand objective, authority, scope, identity, or memory access | `memory-retrieval`, `multi-agent-delegation-memory`, `authority-pipeline` |
| O-16 | Sensitive cleanup and retention | Expired artifacts become tombstones; sensitive values and leases are unusable; lineage and proof-health warnings remain | `memory-phase-o`, `sensitive-working-memory` |
| O-17 | Concurrent agents | Assignment leases prevent duplicate exclusive work; optimistic commits preserve unique attempts and findings | `investigation-assignment-leases`, `multi-agent-delegation-memory` |
| O-18 | Renderer attack | IPC rejects cross-project IDs, raw artifact expansion, oversized payloads, unauthorized senders, and raw secret fields | `memory-ipc`, `ipc-contracts`, `security-inspector` |
| O-19 | Legacy retirement | v1 writes fail with `MEMORY_V1_WRITER_RETIRED`; normal whole-memory fallback fails with `MEMORY_CONTEXT_FALLBACK_RETIRED`; explicit downgrade is observable | `memory-phase-o`, `project-memory-context` |
| O-20 | Packaged Windows recovery | Fresh, migrated, moved-workspace, restart, backup recovery, and derived rebuild smoke tests pass | `boot-smoke`, production verification |

## Release evidence

The final gate requires:

- `npm test` with no skipped Memory v2 tests.
- `npm run verify:production`.
- A clean-checkout packaged Windows smoke run covering O-01 through O-20 where applicable.
- Persisted-output scans with seeded raw cookie, token, authorization header, certificate private key, and passphrase values.
- Snapshot/event replay equivalence and SQLite/graph rebuild equivalence.
- Recorded feature-flag state and migration parity results.
