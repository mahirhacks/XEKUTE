# Xekute Context Memory v2 — Operator and Recovery Guide

This guide describes the shipped operational behavior of Context Memory v2. The architecture document remains the design authority; this guide records the concrete paths, feature switches, status dimensions, recovery operations, and downgrade boundaries used by the implementation.

## Memory ownership

| Domain | Canonical responsibility | Safe contents |
| --- | --- | --- |
| Project Memory | What is known about the target | Entities, target claims, relationships, scope-bound facts, provenance, conflicts, and freshness |
| Investigation Memory | What has been tested and what remains | Procedures, applicability, assignments, attempts, blockers, coverage, negative results, and vulnerability candidates |
| Evidence Memory | Confirmed vulnerabilities only | Low/medium/high/critical verified findings, proof references, impact, remediation, retesting, and report metadata |
| Knowledge Base Memory | Reusable methodology | Immutable versioned releases, procedures, prerequisites, verification rules, safety constraints, and source references |
| Agent Session Memory | Exact conversation and resumable continuity | Raw transcript plus Operational Context and protected Sensitive Working Memory sub-stores |

Project, Investigation, Evidence, and Knowledge records are canonical JSON/JSONL data. SQLite and graph data are rebuildable projections. A candidate, assistant statement, informational result, or unverified scanner result cannot become Evidence Memory.

## Concrete storage

- Protected project identity is resolved by the project registry. A workspace move preserves the opaque `proj_` ID.
- The lazy manifest is `.xekute/memory/manifest.json` and is created only after an accepted semantic write or explicit migration initialization.
- Canonical event segments and snapshots are under `.xekute/memory/` and are rebuilt through the event store.
- Artifact metadata is `.xekute/memory/artifacts/registry.json`; raw traffic, screenshots, tool output, and files remain external artifacts referenced by opaque `artifact_` IDs.
- Operational Context checkpoints are held by the app session-memory directory, encrypted when safe storage is available.
- Sensitive Working Memory is held in protected app data, encrypted with Electron `safeStorage` when available, or process-only when it is not. There is no plaintext fallback.
- Audit diagnostics are the redacted hash-chained `.xekute/memory/diagnostics/audit.jsonl` stream.
- `.xekute/context/project-memory.json` remains a read-only compatibility source after v2 writer retirement.

All timestamps are UTC ISO-8601. IDs are opaque prefixed UUIDs. Matching keys are separate SHA-256 hashes and never replace public IDs.

## Feature switches

Feature switches are created in the main process by `src/infrastructure/config/memory-feature-flags.js`; renderer payloads cannot change them. Every switch defaults to `false` so an unopened project and an existing installation preserve legacy behavior.

The switches are independently controlled for durability, Project/Investigation/Evidence writers, Retrieval, Sensitive Working Memory, Operational Context, Context Assembly, derived views, multi-agent memory, UI, and migration dual-read/dual-write. A normal rollout enables the owning phase only after its tests and production verification pass. Keep the switches available until the Phase O approval gate.

## Finalization and status

The terminal user-visible agent block is the semantic commit boundary. Internal tool turns are journaled and reduced, but do not each create Project revisions. The finalization watermark reports the latest sealed block, latest applied block, pending outbox work, failures, and projection lag. Context Assembly waits at most 250 ms for the immediately preceding finalization and exposes a pending gap when it cannot resolve it.

Status dimensions are independent:

`action`, `durability`, `semantic_finalization`, `outbox`, `projection`, `summarization`, `sensitive_store`, and `migration`.

A successful tool action with a failed semantic projection is therefore shown as a successful action and a failed memory subsystem. Do not treat a green action status as proof that all memory destinations are current.

## Context and privacy rules

- Ordinary block completion does not summarize Agent Session Memory.
- Summarization is triggered by context pressure or explicit continuity events only.
- Exact transcript blocks are never rewritten by compression. A checkpoint stores the source boundary, synopsis, deterministic tool ledger, recent exact tail, retained references, revisions, and known gaps.
- Tool and traffic repetition is clustered by tool/route, identity, authorization state, status, response schema, and security-relevant variation. Raw bodies remain artifacts.
- Knowledge bodies and expanded artifacts are leased and disappear from active context at expiry; their IDs and source references remain.
- Sensitive handles contain no raw value, ciphertext, credential-derived preview, or reusable authorization header. A sensitive-use lease authorizes one trusted adapter invocation and expires after 60 seconds if unused.
- Logs, IPC, UI, reports, semantic memories, SQLite, graph views, checkpoints, and audit diagnostics must never contain raw cookies, tokens, authorization headers, private keys, or passphrases.

## Migration and rollback

1. Run migration preview. It is read-only, repeatable, bounded, source-hashed, and reports ambiguous or unverifiable records.
2. Review counts, ownership mappings, warnings, and rejected secret fields.
3. Run additive import. Legacy IDs become aliases; source hashes and migration operation IDs become provenance. Legacy files are not edited or removed.
4. Use dual-read while coverage is incomplete. Canonical v2 records win over stale legacy records.
5. Run shadow comparison and document expected differences before dual-write.
6. Enable canonical v2 writes first, then compatibility projections through the outbox.
7. If a migration batch is unsafe, roll back its visibility using migration metadata. Canonical audit events remain immutable and legacy sources remain untouched.

Migration rollback is metadata-based. It does not delete canonical records or rewrite legacy files. Re-importing a corrected source is a new idempotent batch.

## Retention, deletion, and proof health

Retention maintenance is exposed by `memory-maintenance-service.js`. Artifact expiry creates a tombstone, clears previews and locations, retains the artifact ID and lineage, and makes expansion return `MEMORY_ARTIFACT_EXPIRED`. A missing or changed proof source changes proof health; it does not erase the finding history.

Sensitive project cleanup clears raw values, releases leases, persists the protected deletion state, and emits redacted audit metadata. Session cleanup deletes Operational Context and exact session transcript storage for the selected project/session only. Semantic event history is retained unless an explicit project deletion policy applies.

## Diagnostics and recovery

- `memory:status` reports domain revisions, finalization, outbox, projections, checkpoint status, migration, and maintenance status.
- `memory:diagnostics` reads the redacted audit chain and can verify its hash chain.
- `memory:securityAudit` scans bounded persisted memory output, optional legacy compatibility output, project binding, and runtime-safe values without returning offending values.
- `memory:maintenanceStatus` reports benchmark thresholds and the latest result.
- `memory:maintenanceBenchmark` measures startup, finalization, retrieval, compression, rebuild, and large-history workloads with bounded iterations.
- A corrupted primary snapshot or checkpoint is recovered from its validated backup where possible. Event history remains the rebuild source.
- A corrupted SQLite or graph view is deleted and rebuilt from canonical records; derived rebuild failure never invalidates a semantic commit.

Standard failures use `{ ok:false, code, error, retryable, details }`. Successful mutations use operation ID, record IDs, previous/current revision, changed state, conflicts, and warnings. A no-op does not advance a revision.

## Downgrade boundary

The legacy Project Memory reader remains available for explicit compatibility or downgrade mode. When `projectMemoryV2`, `blockMemoryUpdater`, and `contextAssemblyV2` are active, direct v1 writer calls return `MEMORY_V1_WRITER_RETIRED`; normal whole-memory context compilation returns `MEMORY_CONTEXT_FALLBACK_RETIRED`. An explicit trusted downgrade caller may pass `allowLegacyFallback:true` and receives `legacyFallbackUsed:true` for telemetry.

Before downgrade, preserve the protected registry, canonical event/snapshot backups, migration metadata, and a redacted export. A downgrade does not make v1 authoritative again for records already written to v2; use the compatibility reader or restore a supported pre-v2 backup. Unsupported downgrade combinations must fail with an explicit warning rather than silently rewriting canonical data.

## Release checklist

- All Phase A–O gates and targeted tests are recorded.
- `npm test` and `npm run verify:production` pass from a clean checkout.
- Windows packaged smoke tests pass for fresh, migrated, moved, restart, and recovery cases.
- Canonical records rebuild equivalent SQLite and graph results.
- Secret scans pass for persisted output, IPC, UI, logs, reports, checkpoints, and diagnostics.
- Project contains target knowledge only; Investigation contains work history; Evidence contains verified low–critical findings only.
- Finalization watermark and pending gaps are visible to Context Assembly.
