# Agent-run implementation plan

The target is [the agreed proposal](./proposed-agent-run.md). This migration changes the controller, main-process session lifecycle, provider settings/gateway, child coordination, and composer. Tests run after each phase before the next begins. Existing icon and tooltip changes remain separate workspace changes.

## Current design: one run, one inbox

This section supersedes the decision model, the routing round, independent tasks and compound intent routing described below and in the proposal. Those parts were removed.

A prompt sent while no run is active and no model round is streaming starts a new main task. Any other prompt is a sub-prompt of the active run. It is saved to the session inbox and delivered to the main task at its next boundary, before the next model request. The main agent decides what it means. A change to the current task changes the plan. A separate request goes to a delegated child through `delegate_agent`, while the main agent continues its own work. The run finishes only after every child has reported, and it gives one answer under the original prompt. A message sent inside a delegated child's chat steers that child.

The inbox also carries results that arrive after their round moved on:

- A tool call that is still running when a sub-prompt arrives gets a short grace period (`TOOL_DETACH_GRACE_MS`). After it, the round receives a "continues in the background" outcome and the model reads the sub-prompt. The tool keeps running, and its real result enters the inbox when it finishes.
- A command that outlives its round reports its exit, and its periodic live status, to the inbox from the main process.
- A run that ends its turn while background work is pending parks instead of completing. A late result wakes it, and the agent continues from that result.

Commands, reads, questions, delegation and web research run concurrently. Workspace edits and other mutating tools are serialized per workspace for the duration of the edit only. Delegated children may edit files. They may not spawn further children.

## Definition of done

- A prompt submitted during a model or tool round is durably received and applied at a safe boundary.
- Related input changes the target task; compound input preserves every instruction; independent input creates a separate task without holding main completion.
- Settings choose a decision provider/model independently of execution. Native OpenRouter Decisions uses its own protocol, bounded request, capabilities, and fallback.
- Accepted input, routing, and dispatch recover without duplicate application or duplicate children. A finalization race cannot lose a message.
- Every recognizable tool call has a model-visible paired outcome. Repair and continuation are bounded without imposing a total-job duration limit.
- Cleanup covers acquisition through final persistence. Independent children retain delivery lifetime after main completion; scoped cancellation remains explicit.
- The composer accepts messages while busy and exposes receipt/application. The old renderer prompt queue is migrated and removed.
- Phase tests, regression tests, UI build, and end-to-end boundary scenarios pass. Failures and limitations are recorded rather than counted as passes.

## Phases and gates

- [x] Read the Figure It Out workflow and the Poteto principles.
- [x] Phase 0. Trace the source seams and capture a baseline of the controller, provider, child, and memory tests. Gate passed 120/120 tests; no failures or skips.
- [x] Phase 1. Repair tool feedback and extract bounded round accounting and cleanup contracts. Combined gate passed 148/148 tests, including actual lifecycle handlers and Electron boot smoke. Review fixes covered orphan results after compaction, checkpoint restoration, and volatile polling timestamps.
- [x] Phase 2. Add canonical durable session input and the supervisor acceptance/finalization contract. Gate passed 183/183 tests, including encrypted disk recovery, atomic write faults, route/revision validation, and late input blocking completion.
- [x] Phase 3. Add independent decision settings, role-specific discovery, and the native decision gateway. Combined gate passed 41/41 tests. Separate settings, catalog roles, real HTTP protocol, captured requests, timeout/abort, capability and privacy failures are covered. Boot and context contracts also passed in the isolated settings slice.
- [x] Phase 4. Integrate safe-boundary routing and durable task delivery with orchestrator fallback. Initial gate passed 184/184 tests; the expanded gate passed 195/195. Real encrypted storage and production IPC handlers cover Arial input during model/tool rounds, exact messages, atomic completion, saved plan reuse after cold reopen and revision contracts. Phase 7 adds durable compound spans across primary, independent and dependent destinations.
- [x] Phase 5. Make independent children session-owned and keep dependency-only completion barriers. Gate passed 200/200 tests. Child transcripts, late child steering, replay receipts, unknown effects, encrypted process handles, scoped Stop, mutation reservations and legacy child continuity are covered. Cold process identity requires reconciliation rather than PID-based kill or replay.
- [x] Phase 6. Replace the composer queue with direct input receipt and explicit Send/Stop. Combined gate passed 33/33 tests; the isolated UI slice passed 43/43. Concurrent input, retry IDs, receipt failures, migration, statuses and independent answer delivery have behavioral coverage.
- [x] Phase 7. Final serial regression passed 996/996 tests with no skips. Production invariants and the final UI build passed. Production-handler scenarios cover cold unread recovery, scoped child delivery, paused independent completion and failed-parent cleanup. Independent review reproduced and closed child effect replay and unread recovery gaps. The earlier 959/963 and 991/992 failures and their corrections remain in the trail.

## Verification and decision trail

The test command is `node scripts/verify-agent-run.mjs --phase <phase>`. Baseline and phase suites use one test worker. Full TAP output is stored under `tmp/agent-run-implementation/verification/`; the command reports the log path and exit status. Each phase's evidence will be recorded in `agent-run-implementation.tsv` and in the checklist above.

Encrypted V3 session documents own exact transcripts, task state and input receipts. The long-horizon index is derived state.

Final evidence:

- Full regression: `tmp/agent-run-implementation/verification/regression-2026-10-14T04-19-03.228Z.tap`
- UI build: `tmp/agent-run-implementation/verification/build-ui-final.log`
- Production checks: `tmp/agent-run-implementation/verification/production-final.log`
- Recovery and dependent scope: `tmp/agent-run-implementation/verification/continued-cold-scope.tap`
- Compound receipt status: `tmp/agent-run-implementation/verification/continued-receipts.tap`

## Implemented behavior and limits

Send durably records the intact message while the current model/tool round finishes. At its next checkpoint, the orchestrator routes the message, changes the relevant task revision and continues. A wholly separate request starts an independent task. Compound messages can partition exact original spans among destinations, retaining stable intent IDs and the complete source in encrypted storage. The composer shows Applied only after every destination has applied its delivery.

Main, independent and required delegated child engines save model rounds before tool effects. Recovery reuses completed tool outcomes. An effect without a durable outcome requires reconciliation. Cold unread receipts wake execution even if the previous main task completed or initial admission never started. Fresh tasks keep prior orchestration waves in their prior task record.

Decision settings are independent of execution settings. Known Choice-capable OpenRouter models provide advisory routing evidence. Unsupported or unknown capabilities skip the native call and use the orchestrator. Automatic routing needs a calibrated evidence policy; none is shipped. Gateway verification uses local HTTP fixtures, without a live paid OpenRouter request.

Workspace mutations use a conservative workspace reservation. A process recovered from another host lifetime is marked `reconciliation_required`; the application does not infer ownership from a PID or replay its command. Resolve that process before another task writes to the same workspace.

The proposal also sketches durable unresolved-intent records and explicit natural-language replacement/supersession transitions. Those are further extensions to the implemented routing contract. Ambiguity uses the existing question workflow; immediate cancellation uses the separate scoped Stop control.

Final review used `gpt-6-astra` at high effort. This is an independent review within the GPT family. The trail records failed gates and their later corrections.
