# Plan: LLM-Controlled Unified Tool Process Monitoring

## Goal

Replace the current single process-kill timeout for typed security tools with a checkpoint-driven lifecycle:

1. The LLM starts a tool with a requested monitoring interval and recent-log line count.
2. The process continues running when that interval expires.
3. XEKUTE returns terminal status plus the requested tail of recent logs.
4. The LLM chooses `continue` with a new interval/log-tail request or `stop`.
5. The loop persists across agent turns and never restarts the process.
6. Host-enforced cancellation, scope expiry, shutdown, resource limits, and a separate hard deadline remain non-bypassable.

The existing `legacy` rollout remains behavior-compatible until unified monitoring is proven.

## Safety and timeout model

Separate the current timeout concepts:

- `monitor_ms` — LLM-selected checkpoint interval; never kills the process.
- `hard_deadline_ms` — host/policy kill deadline; not model-bypassable. Effective deadline is the minimum of the configured operation maximum, scope-decision expiry, and application shutdown/cancellation.
- tool-native request timeout — only for tools that need per-request limits (`httpx`, `sqlmap`, traceroute); it is not the process lifetime.
- `wait_ms` — compatibility/checkpoint field for legacy terminal waits; never treated as a kill timer when `killOnTimeout` is false.

Add a distinct security-operation maximum-runtime policy, separate from the current 15-second request timeout. Preserve the current request timeout for HTTP/native-request semantics. The new process hard deadline is clamped by host policy and cannot be extended by model input.

## Implementation tasks

### 1. Extend unified contracts and result data

Files:

- `src/contracts/tool/unified-schemas.js`
- `src/contracts/tool/tool-result.js`
- `src/contracts/tool/tool-result-codes.js`
- `src/contracts/tool/operation-state.js`
- `src/application/tools/unified-tool-router.js`

Changes:

- Add `control: start | continue | stop` to `run_test_case` and the applicable managed command operation.
- Add optional `operation_id`, `monitor_ms`, and `log_tail_lines` inputs.
- Require `operation_id` for `continue` and `stop`; require the typed test fields for `start`.
- Enforce runtime conditional validation, bounds, and closed fields:
  - checkpoint interval minimum/maximum;
  - log-tail minimum/maximum;
  - operation ID ownership and assessment binding;
  - no model-provided hard deadline.
- Extend the `run_test_case` result-data schema with bounded fields:
  - `process_status`;
  - `running`;
  - `elapsed_ms`;
  - `exit_code`/`signal`;
  - `monitor_ms`;
  - `lines_available`/`lines_returned`;
  - `log_lines` containing only bounded redacted recent lines;
  - opaque `log_artifact_ref`/`evidence_refs`;
  - `cleanup` status;
  - `continuation_required`.
- Add stable codes for checkpoint, continuation required, operation not found, invalid control, hard deadline, process stop, and missing continuation decision.
- Ensure standard result projection preserves these bounded fields while excluding raw stdout/stderr/transcripts.

Verification:

- Contract tests reject missing/invalid control combinations, oversized line requests, unknown fields, and model hard-deadline fields.
- Result tests verify bounded log lines and opaque artifact references.

### 2. Split security adapter configuration into monitor and process limits

Files:

- `src/adapters/tools/cyber/security-tool-adapters.js`
- `src/adapters/tools/core/tool-handlers.js`
- `src/application/tools/ports/testing-port.js`
- `src/application/policies/runtime-policy-rules.js`
- `src/application/policies/policy-engine.js`

Changes:

- Replace the current security adapter use of `configuration.timeoutMs` as the process lifetime with separate fields:
  - `requestTimeoutMs` for native request flags where applicable;
  - `monitorMs` for the next checkpoint;
  - `hardDeadlineMs` supplied only by host policy/context.
- Keep nmap/naabu command construction free of an artificial 15-second process timeout.
- Preserve native timeout arguments for `httpx`, `sqlmap`, and traceroute as per-request/per-hop controls.
- Add a policy setting for maximum security-operation runtime with explicit lower/upper clamps.
- Compute the effective hard deadline centrally from policy and scope expiry; do not accept a model-authored hard deadline.
- Normalize the initial monitor interval conservatively when omitted, but allow the LLM to select a later interval within bounds.

Verification:

- Adapter tests prove nmap/naabu do not receive a forced 15-second kill setting.
- Policy tests prove request timeout and operation hard deadline are independent.
- Tests prove scope expiry and policy maximum always cap the operation.

### 3. Add a managed process session and line-ring buffer

Files:

- `src/adapters/tools/os/terminal-runner.js`
- `src/presentation/electron/main.js`
- `src/application/tools/ports/command-port.js`
- `src/adapters/tools/cyber/subagent-runner.js`

Changes:

- Add a managed executable/session API while preserving the existing legacy runner API during migration:
  - `startManagedProcess`;
  - `checkpointProcess`;
  - `continueProcess`;
  - `stopProcess`;
  - `getProcessStatus`.
- Store a durable process record keyed by `operation_id`, including PID/terminal ID, start time, status, monitor timer, hard deadline, owner, scope binding, and cleanup state.
- Maintain a bounded chronological stdout/stderr line ring buffer. Each line must retain stream/source and sequence metadata internally; model output receives only the requested recent lines.
- Persist complete redacted output as an artifact and return only opaque artifact/evidence IDs in the result envelope.
- When `log_tail_lines` exceeds available lines, return all available lines with `lines_returned < requested`; do not return an error.
- Make monitor expiry checkpoint-only. It must resolve a checkpoint result while leaving the child alive.
- Make hard-deadline expiry terminate the complete process tree and return `partial`/`cancelled` with cleanup and evidence references.
- Pass the operation `AbortSignal` into the managed process runner and terminate promptly on cancellation.
- On Windows, use recursive `taskkill /PID /T /F` through the existing process-tree helper; on Unix-like systems, use process-group/tree termination where available and preserve cleanup status.
- Keep legacy `run_command`/`start_process` checkpoint behavior intact and explicitly distinguish checkpoint timers from kill timers in code and tests.

Verification:

- A long-running fixture survives a short monitor checkpoint.
- The same PID/process record survives repeated continuation calls.
- Stop, cancellation, scope expiry, hard deadline, and shutdown terminate the process tree.
- Partial output and cleanup status survive every termination path.

### 4. Implement managed `run_test_case` and command operations

Files:

- `src/application/tools/ports/testing-port.js`
- `src/application/tools/ports/command-port.js`
- `src/application/tools/unified-tool-router.js`
- `src/infrastructure/di/container.js`

Changes:

- `start` creates the typed process operation and waits only for the first checkpoint or process exit.
- `continue` resolves the existing operation by opaque ID, verifies actor/profile/assessment/scope ownership, arms a new monitor timer, and never spawns a second process.
- `stop` resolves the operation, terminates the process tree, persists cleanup/evidence, and returns a terminal result.
- Use the same lifecycle for safe managed `exec_command`, while preserving the typed-security rejection for nmap/naabu/security CLIs.
- Route legacy `run_security_tool` through the managed typed testing port internally; do not expose it in the provider catalog.
- Reject missing/invalid continuation decisions safely. The default fail-safe is to stop the process and return `MISSING_CONTINUATION_DECISION`, not silently continue indefinitely.
- Ensure result status distinguishes:
  - checkpoint while running (`partial`, `continuation_required: true`);
  - clean process exit (`success`/`failed`);
  - explicit stop (`cancelled` or terminal stop code);
  - hard deadline/cancellation (`cancelled`/`partial` with cleanup state).

Verification:

- Unit tests cover start/continue/stop, duplicate continuation, missing operation ID, wrong owner, and no process restart.
- Security tests prove no generic fallback can execute target-directed commands.

### 5. Persist operation state and host protocol resumption

Files:

- `src/application/tools/operation-context.js`
- `src/contracts/tool/operation-state.js`
- `src/application/tools/unified-tool-router.js`
- `src/application/agent/controller.js`
- `src/presentation/electron/main.js`
- `src/application/agent/memory/action-log.js`

Changes:

- Expand operation states to include `running`, `checkpointed`, `awaiting_decision`, and terminal states while retaining idempotent transitions.
- Persist operation ID, audit ID, tool/input digest, actor/profile, assessment/scope binding, PID/terminal reference, monitor/hard-deadline metadata, evidence refs, and cleanup state.
- Never persist raw secrets or unbounded logs in model-visible state; store logs as redacted artifacts.
- When a checkpoint arrives, the controller feeds the bounded terminal status/log tail to the model and allows a continuation tool call without consuming the ordinary fixed agent-round budget indefinitely.
- Host resumption must restore the same operation/audit IDs and process record. Duplicate resume events must not dispatch twice.
- If the model returns prose instead of `continue`/`stop`, apply the fail-safe stop policy and record the reason.
- Preserve existing approval/clarification/suspension/cancellation host protocol contracts.

Verification:

- Simulate a process requiring more than ten checkpoints; verify the agent resumes through persisted operation state rather than failing from the normal round budget.
- Restart-safe state tests verify continuation uses the same PID/operation ID or safely reports that the process is no longer recoverable.
- Cancellation tests verify evidence and cleanup state are preserved.

### 6. Add deterministic log-tail and timeout regression tests

Files:

- `test/terminal-wait.test.js`
- `test/tool-runtime.test.js`
- `test/unified-tool-runtime.test.js`
- `test/unified-tool-router.test.js`
- `test/unified-tool-security.test.js`
- new `test/managed-process-monitoring.test.js`

Required cases:

- 60-second fixture with a 5-second monitor returns a checkpoint and remains alive.
- `continue` with a new interval returns another checkpoint without restarting.
- Requesting 500 lines when only 20 exist returns all 20 successfully.
- Mixed stdout/stderr recent-line ordering is deterministic and redacted.
- Explicit `stop` terminates the complete process tree.
- Hard deadline terminates the tree and preserves partial evidence.
- Scope expiry/cancellation terminate promptly.
- Missing continuation decision stops safely.
- nmap/naabu no longer terminate at the old 15-second policy timeout unless the host hard deadline is configured to that value.
- Legacy checkpoint-only waits remain non-killing when `killOnTimeout: false`.
- Provider catalog remains exactly 17 names and contains no compatibility tools.

### 7. Update documentation and migration records

Files:

- `docs/architecture/exec-command-capabilities.md`
- `docs/architecture/unified-vapt-tool-surface.md`
- `docs/migration/unified-vapt-tool-surface.md`
- `.cursor/specs/unified-vapt-tool-surface/tasks.md`

Document:

- monitor versus hard-deadline semantics;
- LLM `start`/`continue`/`stop` protocol;
- log-tail behavior when fewer lines exist;
- process ownership and cleanup;
- scope/policy/shutdown kill gates;
- legacy compatibility behavior and rollout/rollback.

### 8. Final verification and graph refresh

Run, in order after implementation:

1. focused managed-process tests;
2. `npm test`;
3. `npm run verify:production`;
4. `npm run audit:runtime`;
5. `npm run package` / supported Windows packaging workflow;
6. `npm run verify:unified-harness` with the permanent protected fixture;
7. safe authorized-domain HEAD check only unless an explicit active-test scope decision exists;
8. `graphify update .` last.

## Verification gates

- No source or generated graph refresh until all code/tests/docs changes are complete.
- No process-kill timer may be driven by `monitor_ms`.
- No model input may extend the host hard deadline, bypass scope expiry, bypass cancellation, or bypass shutdown cleanup.
- No continuation may spawn a second process for the same operation ID.
- The permanent protected fixture must remain present and byte-identical after every harness run.

## Rollback and exit criteria

Rollback to `legacy` catalog mode if unified continuation changes provider payloads, IPC contracts, assessment schemas, or existing terminal behavior. The change is complete only when all required gates pass and the task file records each completed subtask with any explicitly unavailable capability documented rather than hidden.
