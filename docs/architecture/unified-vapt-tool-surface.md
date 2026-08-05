# Unified VAPT Tool Surface

XEKUTE exposes the versioned `xekute.vapt.v1` model catalog with exactly 17 operation-oriented tools:

`exec_command`, `read_file`, `search_workspace`, `apply_patch`, `manage_plan`, `manage_state`, `check_scope`, `ingest_traffic`, `manage_identity`, `replay_request`, `run_test_case`, `browser_action`, `compare_responses`, `verify_finding`, `store_finding`, `attack_graph`, and `delegate_agent`.

Legacy tools remain application-internal compatibility handlers. They are not serialized by the unified provider catalog. Host-managed approval, clarification, suspension, resumption, cancellation, schema loading, and lifecycle events are protocol capabilities, not model-visible tools.

## Routing

The DI composition root constructs one `UnifiedToolRouter`. The router validates the public name, closed action schema, profile subset, operation/audit IDs, scope decision, approval grant, cancellation/deadline, adapter capability, and result envelope before dispatching a typed application port.

Raw stdout, stderr, browser output, scanner output, secrets, and transcripts are persisted as redacted artifacts or evidence. Model results contain bounded data and opaque references only.

## Rollout

- `legacy` — default compatibility catalog and legacy controller execution.
- `unified_shadow` — legacy model payload remains active; the exact unified catalog and serialized size are emitted as diagnostics.
- `unified_enabled` — provider payload and controller execution use the unified catalog/router.

Rollback changes the catalog selector only; preload IPC channels and assessment data remain unchanged.

## Migration status

- Workspace/control: unified ports for command, file/search, patch, plan, and state.
- Scope/traffic/identity/replay: unified ports with host-only scope decisions and protected identity storage.
- Testing/analysis: typed test-case, response comparison, finding storage, graph, browser capability, and delegation boundaries.
- Compatibility: legacy handlers remain available to the application during migration and are not provider tools.
- Independent verifier execution remains host-injected through the existing verifier callback; missing verifier capability returns explicit `unavailable`.
