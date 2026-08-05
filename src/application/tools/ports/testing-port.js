"use strict";

const { createManagedProcessSession } = require("../managed-process-session");
const { RESULT_CODES } = require("../../../contracts/tool/tool-result-codes");

function createTestingPort({
  buildAction,
  securityAdapters,
  terminalHost,
  assessmentWorkspace,
  persistArtifact = null,       // (workspace, redactedText, meta) => artifactId | ""
  persistDescriptor = null,     // (descriptor) => void
  loadDescriptor = null,        // (managedOperationId) => descriptor | null
  terminateProcessTree = null,
  now = Date.now,
  policy = {},
} = {}) {
  const managed = createManagedProcessSession({
    persistArtifact,
    persistDescriptor,
    loadDescriptor,
    terminateProcessTree,
  });

  function managedParams(input, action) {
    const dump = structuredDump(action);
    return {
      managedOperationId: String(input.managed_operation_id || `managed-${input.test_case_id || input.executor || "test"}-${Date.now().toString(36)}`),
      auditId: String(input.audit_id || action.auditId || ""),
      executable: action.executable,
      args: action.processArgs || [],
      cwd: action.cwd || action.workspace || "",
      env: {},
      monitorMs: action.configuration.monitorMs,
      hardDeadlineAt: action.configuration.absoluteDeadlineMs ? now() + action.configuration.absoluteDeadlineMs : null,
      scopeExpiresAt: null,
      continuationDecisionTimeoutMs: undefined,
      maxManagedContinuationTurns: action.configuration.maxManagedContinuationTurns,
      maxManagedContinuationTokens: action.configuration.maxManagedContinuationTokens,
    };
  }

  function structuredDump(action) {
    return {
      adapterId: action.adapterId,
      executable: action.executable,
      processArgs: action.processArgs,
      configuration: action.configuration,
      target: action.target,
      outputPath: action.outputPath,
      command: action.command,
    };
  }

  async function startManaged(input, context, action) {
    if (typeof securityAdapters?.execute !== "function" && typeof terminalHost?.runExecutable !== "function") {
      return { ok: false, unavailable: true, code: "ADAPTER_UNAVAILABLE", error: "Typed test-case adapter is unavailable." };
    }
    const params = managedParams(input, action);
    params.workspace = context.workspace || "";
    params.auditId = params.auditId || context.auditId || "";
    const started = managed.startManagedProcess(params);
    if (!started.ok) return { ok: false, code: started.code || "PROCESS_START_FAILED", error: started.error };
    const { session, managedOperationId } = started;
    const checkpoint = managed.checkpointProcess(managedOperationId, { workspace: context.workspace, logTailLines: input.log_tail_lines || 20 });
    if (!checkpoint.ok) return checkpoint;
    checkpoint.managed_operation_id = managedOperationId;
    checkpoint.operation_id = context.operationId;
    checkpoint.audit_id = context.auditId;
    return checkpoint;
  }

  async function continueManaged(input, context, action) {
    const result = managed.continueProcess(String(input.managed_operation_id || ""), {
      checkpointId: input.checkpoint_id,
      monitorMs: input.monitor_ms || action?.configuration?.monitorMs,
      workspace: context.workspace,
    });
    if (!result.ok) {
      if (result.code === "OPERATION_NOT_FOUND") return { ok: false, code: "OPERATION_NOT_FOUND", error: result.error || "Unknown managed operation." };
      return { ok: false, code: result.code, error: result.error || "Continuation rejected." };
    }
    const checkpoint = managed.checkpointProcess(input.managed_operation_id, { workspace: context.workspace, logTailLines: input.log_tail_lines || 20 });
    if (!checkpoint.ok) return checkpoint;
    checkpoint.managed_operation_id = input.managed_operation_id;
    checkpoint.operation_id = context.operationId;
    checkpoint.audit_id = context.auditId;
    return checkpoint;
  }

  async function stopManaged(input, context) {
    const result = managed.stopFromModel({
      managedOperationId: String(input.managed_operation_id || ""),
      checkpointId: input.checkpoint_id,
      reason: input.stop_reason || "Process stopped by the model.",
      workspace: context.workspace,
    });
    if (!result.ok) return { ok: false, code: result.code, error: result.error || "Stop rejected." };
    result.operation_id = context.operationId;
    result.audit_id = context.auditId;
    return result;
  }

  async function statusManaged(input, context) {
    const result = managed.getProcessStatus(input.managed_operation_id);
    if (!result.ok) return { ok: false, code: result.code, error: result.error || "Unknown managed operation." };
    result.operation_id = context.operationId;
    result.audit_id = context.auditId;
    return result;
  }

  async function execute(input, context) {
    const action = input.action || "start";
    if (action === "continue") return continueManaged(input, context);
    if (action === "stop") return stopManaged(input, context);
    if (action === "status") return statusManaged(input, context);
    if (action !== "start" && action !== "execute") return { ok: false, code: "UNKNOWN_ACTION", error: `Unsupported run_test_case action: ${action}` };
    // `execute` is a legacy alias for a one-shot `start`; both begin a managed
    // process that may checkpoint and require continuation.

    const built = buildAction({
      adapter_id: input.test_case_id || input.executor || input.category,
      target: input.target,
      technique_ids: input.technique_ids || [input.category],
      evidence_plan: input.expected_evidence || input.evidence_plan || [],
      configuration: {
        rateLimit: input.rate_limit,
        concurrency: input.concurrency,
        monitorMs: input.monitor_ms,
        absoluteDeadlineMs: input.absolute_deadline_ms ?? input.timeout_ms,
        maxManagedContinuationTurns: input.max_managed_continuation_turns,
        maxManagedContinuationTokens: input.max_managed_continuation_tokens,
        ...(input.arguments || {}),
      },
    }, policy);
    if (!built.ok) return built;
    if (!securityAdapters?.execute && !terminalHost?.runExecutable) return { ok: false, unavailable: true, code: "ADAPTER_UNAVAILABLE", error: "Typed test-case adapter is unavailable." };
    if (context.isCancelled?.()) return { ok: false, cancelled: true, code: "OPERATION_CANCELLED", error: "Test case cancelled." };
    return startManaged(input, context, built.action);
  }

  return Object.freeze({ execute, managed });
}

module.exports = { createTestingPort };
