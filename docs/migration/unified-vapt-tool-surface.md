# Unified VAPT Tool Surface Migration

## Wave 10.1a — Workspace/control

Legacy `run_command`, process, file/search/patch, plan, and state handlers remain application-internal. Unified `exec_command`, `read_file`, `search_workspace`, `apply_patch`, `manage_plan`, and `manage_state` route through typed application ports and the single `UnifiedToolRouter`.

## Wave 10.1b — VAPT/assessment

Legacy `run_security_tool`, traffic ingestion, finding, map, and verifier handlers remain compatibility paths for the legacy rollout. Unified scope, traffic, identity, replay, test-case, response, finding, graph, browser, and delegation ports are registered behind the same router. Missing capabilities return explicit `unavailable`; no generic fallback is used.

## Deprecation policy

Compatibility handlers are not provider schemas. They remain until unified operation coverage and production rollout evidence are complete. The rollout selector is:

- `legacy` — current default and rollback target.
- `unified_shadow` — legacy payload plus deterministic unified catalog diagnostics.
- `unified_enabled` — unified provider schemas and router execution.

No preload IPC method, channel, result envelope, renderer global, or assessment schema is changed by this migration.
