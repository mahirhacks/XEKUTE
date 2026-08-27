# Xekute Context Memory v2 — Implementation Plan

This file is the execution companion to [context_memory_architecture.md](./context_memory_architecture.md). The architecture document defines ownership and behavior; this document defines implementation order and verification gates.

## Execution contract

Implement Phases A–O in order. Each sub-task is an atomic implementation unit. A later sub-task may not start until the current sub-task's completion criteria and targeted tests pass. Each task has a task-level integration gate. Each phase has a phase-level gate consisting of its task gates, phase scenarios, and `npm test`.

Use CommonJS, Node.js 22, Electron main-process dependency injection, JSON/JSONL canonical records, and repository-native validators. Existing v1 files and behavior remain available until migration and cutover gates pass. New readers and writers are feature-flagged and disabled by default.

Every sub-task specification must contain:

1. objective;
2. implementation approach;
3. dependencies;
4. completion criteria;
5. targeted testing.

Every task must end with `Task <id> verification testing`. Every phase must end with `Phase <letter> verification and testing`.

## Fixed implementation decisions

- Use opaque `crypto.randomUUID()` IDs with type prefixes and separate SHA-256 canonical keys.
- Resolve durable `project_id` through the protected project registry, not the workspace path.
- Use UTC ISO-8601 timestamps.
- General memory records cannot contain raw cookies, tokens, authorization headers, private keys, passphrases, or secret fields.
- Standard errors are `{ ok:false, code, error, retryable, details }`.
- Standard mutation results include operation ID, record IDs, old/new revisions, `changed`, conflicts, and warnings.
- No-op mutations do not advance revisions.
- Query defaults are limit 50, maximum 200, and graph depth maximum 3.
- JSONL event records are limited to 1 MiB; segments rotate at 16 MiB or 10,000 events.
- Context Assembly waits at most 250 ms for the immediately preceding finalization.
- Sensitive use leases are one-use and expire after 60 seconds.
- Knowledge bodies expire on compression, close, release invalidation, or explicit release.

## Phase A — Contracts, identity, and guardrails

### Task A1 — Common memory contracts

- A1.1: implement record, mutation, query, revision, actor, provenance, sensitivity, and error envelopes; reject invalid domains, ownership, IDs, revisions, provenance, size, and secret fields; add `test/memory-contracts.test.js`.
- A1.2: implement opaque IDs, canonical-key hashing, project-bound references, aliases, merge redirects, and legacy aliases.
- A1.3: implement ownership matrix and lifecycle transition validation for Project, Session, Investigation, Evidence, and Knowledge.

Task A1 verification testing: run contract tests and verify deterministic serialization and illegal cross-domain write rejection.

### Task A2 — Feature flags and import boundaries

- A2.1: add main-process-owned v2 feature flags and expose them through the DI container with all flags disabled by default.
- A2.2: extend architecture-import tests to preserve domain/application/storage/agent/IPC/renderer dependency direction.

Task A2 verification testing: run contract, DI, IPC, and architecture-import tests with flags disabled and selectively enabled.

### Phase A verification and testing

Run `npm test`; verify an empty project does not scaffold memory; verify v1 behavior is unchanged with flags off.

## Phase B — Durability foundation

### Task B1 — Stable project identity and lazy manifest

- B1.1: integrate stable project registry identity and workspace-move aliases.
- B1.2: create lazy `.xekute/memory/manifest.json` with schema, project ID, domain revisions, segment/snapshot references, outbox, watermark, and projection state.

Task B1 verification testing: test project moves, duplicate workspaces, registry recovery, empty reads, rejected writes, and first accepted write.

### Task B2 — Events, snapshots, and artifacts

- B2.1: implement segmented append-only execution and semantic event storage with rotation, hashes, replay, duplicate protection, and partial-tail recovery.
- B2.2: implement atomic snapshots, backups, validation-before-replace, and manifest ordering.
- B2.3: implement artifact registry for files, content hashes, and JSONL source positions with sensitivity, redacted previews, retention, and integrity state.

Task B2 verification testing: fault-inject writes and compare event replay with snapshots.

### Task B3 — Finalization queue, outbox, and watermark

- B3.1: implement one idempotent encrypted block-finalization job per terminal block.
- B3.2: implement cross-memory outbox operations and restart recovery.
- B3.3: implement per-project finalization watermark and bounded wait/status API.

Task B3 verification testing: test duplicate sealing, concurrent sessions, crashes between commits, timeout, and recovery.

### Phase B verification and testing

Run `npm test`; demonstrate crash/restart replay equivalence and v1 compatibility with v2 flags disabled.

## Phase C — Project Memory v2

### Task C1 — Project domain model

- C1.1: implement the canonical entity catalogue and normalization for target/application entities.
- C1.2: implement claim predicates, typed values, provenance, temporal fields, confidence, freshness, and claim lifecycle.
- C1.3: implement closed typed Project relationships and endpoint/cardinality validation.

Task C1 verification testing: normalize ontology and Map fixtures and test every entity/relationship type.

### Task C2 — Project mutations and queries

- C2.1: implement exact identity resolution, aliases, explicit merges, redirects, and fuzzy-match suggestions without mutation.
- C2.2: implement block-finalized material-delta Project mutations, corroboration, dispute, supersession, and secret rejection.
- C2.3: implement bounded Project views: overview, entity, search, neighbors, claims, conflicts, changes, provenance, and coverage inputs.

Task C2 verification testing: replay identical mutations and compare IDs, snapshots, ordering, and revisions.

### Task C3 — Persistence and v1 compatibility

- C3.1: connect Project domain events and snapshots to canonical storage.
- C3.2: add additive v1 adapter/import preview with warnings, source hashes, aliases, and no automatic verification.

Task C3 verification testing: compare v1 compatibility views and v2 ownership without changing legacy files.

### Phase C verification and testing

Run Project, ontology, Map, profile, compatibility, and full regression tests.

## Phase D — Block reducer and Memory Updater

### Task D1 — Immediate trusted execution capture

- D1.1: define typed execution events for tool lifecycle, artifacts, verification, process state, specialist returns, operator assertions, and terminal blocks.
- D1.2: capture exact transcript, artifact references, capsules, and trusted events at runtime without semantic writes during internal loops.

Task D1 verification testing: run tool, authority, capsule, artifact, and journal tests.

### Task D2 — Deterministic reduction and finalization

- D2.1: validate capsules and deterministically produce Project, Investigation, verification, residue, and cluster outputs.
- D2.2: finalize Project Memory once per terminal block and emit no-op results for non-material blocks.
- D2.3: integrate independent action, durability, finalization, projection, summarization, and sensitive-store status.

Task D2 verification testing: run long tool-loop, duplicate finalization, no-new-fact, crash, and cancellation scenarios.

### Phase D verification and testing

Run `npm test`; prove 100 internal tools produce one semantic finalization and deterministic reducer output.

## Phase E — Knowledge releases and Retrieval

### Task E1 — Immutable Knowledge releases

- E1.1: implement release/procedure contracts, hashes, prerequisites, verification rules, safety constraints, and remediation metadata.
- E1.2: ingest current Markdown skills and WSTG fixtures into immutable releases with aliases.

Task E1 verification testing: verify immutable reload, hash reproducibility, malformed-release rejection, and current skill compatibility.

### Task E2 — Retrieval and selection

- E2.1: implement bounded cross-memory Retrieval request/result contracts.
- E2.2: implement explicit selection lifecycle and pinned release/project revision.
- E2.3: implement session/objective Knowledge leases, expiry, token caps, and references after body expiry.

Task E2 verification testing: test limits, cursors, sensitivity, invalid IDs, selection replay, and lease expiry.

### Task E3 — Applicability engine

- E3.1: hash normalized Project coverage inputs and distinguish material from cosmetic changes.
- E3.2: evaluate pinned procedures and emit deterministic create, retarget, reprioritize, retest, and not-applicable proposals.

Task E3 verification testing: instrument Knowledge calls and prove they occur only for material Project changes or explicit refresh.

### Phase E verification and testing

Run Retrieval/Knowledge suites and `npm test`; verify pinned release reproducibility and bounded access.

## Phase F — Investigation Memory

### Task F1 — Investigation domain and persistence

- F1.1: implement hierarchy, statuses, pinned sources, applicability, assignments, and custom investigations.
- F1.2: implement attempts, outcomes, negative results, blockers, coverage dimensions, and remaining work.
- F1.3: implement Investigation events, snapshots, revisions, queries, and outbox support.

Task F1 verification testing: run lifecycle, attempt, negative-result, replay, and storage tests.

### Task F2 — Dual update channels

- F2.1: apply Retrieval applicability deltas without deleting history.
- F2.2: apply direct trusted execution deltas even when Project Memory is unchanged.
- F2.3: merge applicability first and execution second with idempotency and bounded queries.

Task F2 verification testing: test same-block dual updates, no-new-fact coverage, duplicates, concurrency, and stale revisions.

### Phase F verification and testing

Run Investigation, updater, Retrieval, Project, migration-routing, and full regression tests.

## Phase G — Evidence Memory

### Task G1 — Verified-finding domain

- G1.1: implement confirmed low/medium/high/critical finding schema, identity, fingerprint, proof, impact, remediation, and report refs.
- G1.2: implement `verified`, `needs_retest`, `remediated`, `accepted_risk`, and `duplicate` lifecycle.
- G1.3: implement Evidence events, snapshots, proof-health, revisions, and bounded queries.

Task G1 verification testing: reject informational/candidate/inconclusive records and test proof loss without history loss.

### Task G2 — Verification and promotion

- G2.1: integrate trusted verification gate, scope, baselines, comparisons, and independent verifier rules.
- G2.2: promote Investigation verification through idempotent cross-memory outbox operations.
- G2.3: implement remediation, retest, and redacted report projection.

Task G2 verification testing: fault-inject promotion and test accept/reject/inconclusive/retest paths.

### Phase G verification and testing

Run `npm test`; prove candidates remain in Investigation and informational results never enter Evidence.

## Phase H — Sensitive Working Memory

### Task H1 — Protected store and handles

- H1.1: implement sensitive entries and handles bound to project/session/agent/identity/origin/context/lifecycle.
- H1.2: implement encrypted sensitive-session containers with process-only degradation and no plaintext fallback.
- H1.3: implement one-use leases and redacted audit metadata.

Task H1 verification testing: test encryption availability, corruption, cross-binding, expiry, and plaintext scans.

### Task H2 — Cookie, token, and certificate lifecycles

- H2.1: implement browser-grade cookie matching and rotation.
- H2.2: implement typed tokens, headers, nonces, signing state, and selected auth browser storage.
- H2.3: integrate client certificate chains, passphrases, and Identity Vault private-key references.

Task H2 verification testing: run browser, replay, token, certificate, and Identity Vault cases.

### Task H3 — Trusted tool integration

- H3.1: materialize raw values only in authorized main-process request/browser adapters.
- H3.2: apply response-driven rotation immediately for subsequent calls in the same block.
- H3.3: revoke/expire/delete handles and deny implicit subagent inheritance.

Task H3 verification testing: run authorized/unauthorized tool, rotation, logout, restart, delegation, and secret-scan cases.

### Phase H verification and testing

Run security/browser/request/identity suites and `npm test`; prove no raw secret appears outside protected/process-only SWM.

## Phase I — Operational Context Memory

### Task I1 — Transcript boundaries and checkpoints

- I1.1: persist exact transcript and block/checkpoint boundaries incrementally.
- I1.2: implement structured Operational Context checkpoints with revisions, refs, known gaps, and safe handle metadata.

Task I1 verification testing: run transcript, session-store, checkpoint, and migration tests.

### Task I2 — Deterministic tool-event ledger

- I2.1: cluster repeated tool activity while retaining failures and conclusion-changing variants.
- I2.2: apply traffic fingerprints and retain raw traffic only in artifacts/transcript.

Task I2 verification testing: reorder inputs and require identical ledger output and hashes.

### Task I3 — Context Summarizer

- I3.1: implement pressure/continuity triggers; ordinary block completion does not summarize.
- I3.2: implement schema-constrained conversation synopsis with deterministic fallback.
- I3.3: atomically activate synopsis, tool ledger, recent tail, and refs.

Task I3 verification testing: run pressure, provider failure, hallucinated-ID, concurrent append, crash, and secret-scan tests.

### Phase I verification and testing

Run `npm test`; prove exact transcripts are unchanged and emergency compression works without a model.

## Phase J — Context Assembly

### Task J1 — Objective-aware packets

- J1.1: classify objective/mode and select bounded memory policies.
- J1.2: reconcile checkpoint revisions and finalization watermark with a 250 ms wait or explicit pending gap.

Task J1 verification testing: run objective, stale, pending, concurrent-predecessor, and cross-project cases.

### Task J2 — Token-bounded prompt assembly

- J2.1: implement elastic budget allocation and source/token accounting.
- J2.2: route the agent controller through v2 Context Assembly under a flag.
- J2.3: implement stale-reference and sensitive-handle health behavior on resume.

Task J2 verification testing: run prompt snapshots, provider contracts, token limits, resume, and secret scans.

### Phase J verification and testing

Run `npm test` and `npm run verify:production`; prove no normal whole-memory injection.

## Phase K — Derived SQLite and Knowledge Graph views

### Task K1 — Rebuildable SQLite index

- K1.1: index canonical cross-memory records with source IDs, revisions, lifecycle, keys, and watermark.
- K1.2: implement asynchronous incremental projection, failure recovery, and full rebuild.

Task K1 verification testing: delete/rebuild SQLite and compare normalized results.

### Task K2 — Federated graph

- K2.1: project target, investigation, evidence, and methodology layers without raw sensitive values.
- K2.2: preserve the deterministic traffic Map as a source and compatibility view.
- K2.3: add bounded graph traversal and rebuild APIs.

Task K2 verification testing: run graph, Map, traffic, Retrieval, cycle, depth, and rebuild tests.

### Phase K verification and testing

Run `npm test`; verify derived stores cannot create semantic truth and rebuild equivalence holds.

## Phase L — Multi-agent coordination

### Task L1 — Dispatch and assignment leases

- L1.1: create bounded specialist packets with canonical refs and no raw sensitive values.
- L1.2: implement Investigation/test-case leases, expiry, release, and recovery.

Task L1 verification testing: run delegation, coordinator, lease, packet, and secret-scan tests.

### Task L2 — Specialist returns and concurrency

- L2.1: convert specialist returns into trusted structured events.
- L2.2: implement optimistic concurrency, deterministic retry, and conflict preservation.
- L2.3: implement handoff and explicit sensitive-use delegation.

Task L2 verification testing: run overlapping agent, duplicate, conflict, retry, handoff, and handle tests.

### Phase L verification and testing

Run `npm test` with concurrency 2 and confirm no lost updates or implicit handle inheritance.

## Phase M — IPC, UI, and observability

### Task M1 — Privileged IPC and tools

- M1.1: add bounded memory/query/status/migration IPC channels with sender and project validation.
- M1.2: add typed agent-facing Retrieval/memory operations while preserving explicit finding lifecycle tools.

Task M1 verification testing: run IPC, preload, authority, tool registry, limit, and secret-access tests.

### Task M2 — Memory and context UI

- M2.1: make the existing Context Usage popup the only user-facing memory surface. Show fixed token-allocation rows for System prompt, Tool definitions, Project, Investigation, Evidence, Conversation, Rules, and Skills; Conversation combines Active Workflow and the Recent Working Set.
- M2.2: keep canonical Project, Investigation, Evidence, graph, provenance, and migration inspection hidden from ordinary users. Preserve bounded access through trusted internal services, agent retrieval, and privileged diagnostics only; do not mount a Memory Explorer route, sidebar, or popup link.
- M2.3: expose migration, recovery, retry, rebuild, and rollback controls only in privileged diagnostic or recovery workflows, never in the ordinary Context Usage popup.

Task M2 verification testing: verify the fixed token rows and aggregation aliases, assert that no Memory Explorer entry point is mounted, and run UI state, DOM sanitization, stale-state, and secret-fixture tests.

### Task M3 — Status and audit

- M3.1: expose independent action, durability, semantic, outbox, projection, summarization, SWM, and migration statuses.
- M3.2: implement redacted diagnostics and audit exports.

Task M3 verification testing: run status combinations, audit, redaction, and UI tests.

### Phase M verification and testing

Run `npm test` and `npm run verify:production`; verify privileged reads, independent failure status, and rendered-output secret scans.

## Phase N — Migration and cutover

### Task N1 — Additive migration engine

- N1.1: discover/hash/classify legacy sources and produce read-only previews.
- N1.2: import accepted records idempotently with source hashes, aliases, and warnings.
- N1.3: track migration batches and rollback metadata without deleting legacy files.

Task N1 verification testing: run every legacy fixture, malformed/secret-bearing history, repeated import, interruption, and rollback case.

### Task N2 — Dual-read, shadow, and dual-write

- N2.1: read v2 first with tagged legacy fallback and precedence rules.
- N2.2: compare shadow projections and block unexplained loss or verification upgrades.
- N2.3: commit v2 first and compatibility projection through outbox before reader cutover.

Task N2 verification testing: run dual-read, shadow, dual-write, failure, restart, and feature rollback tests.

### Phase N verification and testing

Run `npm test` and `npm run verify:production`; confirm legacy files remain untouched and all mappings are reviewable.

## Phase O — Retirement, hardening, and release

### Task O1 — Security, performance, and maintenance

- O1.1: close the memory threat model across storage, IPC, retrieval, migration, subagents, and diagnostics.
- O1.2: benchmark startup, finalization, retrieval, compression, rebuild, and large-history behavior.
- O1.3: implement retention and deletion behavior with lineage/proof-health warnings.

Task O1 verification testing: run security, performance, retention, recovery, and full secret scans.

### Task O2 — Legacy retirement

- O2.1: stop v1 Project Memory writes after soak/parity gates.
- O2.2: remove whole-memory prompt fallback from normal mode, retaining explicit downgrade mode.
- O2.3: document backup, restore, export, and supported downgrade behavior.

Task O2 verification testing: run runtime tracing, compatibility, prompt, migration, backup, and production tests.

### Task O3 — Final acceptance

- O3.1: execute the complete fresh, migrated, concurrent, crash, move, rebuild, scope, KB, authentication, mTLS, long-loop, no-new-fact, pending-finalization, and compression matrix.
- O3.2: update developer/operator/migration/recovery/security documentation.
- O3.3: require all phase evidence, regression, production, packaging, restore, and secret-scan gates before approval.

Task O3 verification testing: run all tests from a clean checkout and a packaged Windows build.

### Phase O verification and testing

All Phase A–O gates must pass. No skipped v2 tests, unexplained migration loss, plaintext sensitive storage, ownership violation, stale-context failure, or failing production verification may remain.
