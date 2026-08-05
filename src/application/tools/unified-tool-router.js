"use strict";

const crypto = require("node:crypto");
const { PUBLIC_TOOL_NAMES, toolNamesForProfile } = require("../../contracts/tool/unified-catalog");
const { schemaForTool, validateValue } = require("../../contracts/tool/unified-schemas");
const { createToolResult } = require("../../contracts/tool/tool-result");
const { RESULT_CODES } = require("../../contracts/tool/tool-result-codes");
const { createOperationContext } = require("./operation-context");
const { validateScopeDecision } = require("../../contracts/tool/scope-decision");
const { validateApprovalGrant } = require("../../contracts/tool/approval-grant");
const { validateOperationState } = require("../../contracts/tool/operation-state");
const { projectToolResult } = require("./result-projector");

const ACTIONS = Object.freeze({
  exec_command: ["execute"],
  read_file: ["read"],
  search_workspace: ["search_text", "find_files", "list_directory", "inspect_workspace", "get_outline", "ensure_index"],
  apply_patch: ["apply"],
  manage_plan: ["get", "create", "update_step", "complete_step", "close"],
  manage_state: ["get", "query", "set", "append_event", "checkpoint"],
  check_scope: ["evaluate", "issue_decision"],
  ingest_traffic: ["har", "burp", "traffsucker", "raw_http", "proxy", "api_collection"],
  manage_identity: ["list", "describe", "select", "refresh", "revoke", "status"],
  replay_request: ["execute"],
  run_test_case: ["start", "continue", "stop", "status", "execute"],
  browser_action: ["navigate", "click", "fill", "submit", "observe", "screenshot", "inspect_storage", "evaluate_script", "replay_workflow"],
  compare_responses: ["compare", "fingerprint", "authorization_diff"],
  verify_finding: ["assess", "confirm", "negative_control", "retest", "status"],
  store_finding: ["create", "update", "deduplicate", "attach_evidence"],
  attack_graph: ["query_nodes", "query_neighbors", "find_paths", "add_assertion", "promote_assertion", "attach_evidence"],
  delegate_agent: ["delegate"],
});

const ACTIVE_TOOLS = new Set(["replay_request", "run_test_case", "browser_action", "delegate_agent"]);
const SCOPE_REQUIRED_TOOLS = new Set(["replay_request", "run_test_case", "browser_action", "delegate_agent"]);
const SCOPE_CATEGORIES = Object.freeze({ replay_request: "replay", run_test_case: "test_case", browser_action: "browser", delegate_agent: "delegation" });
const PROFILE_DENIED = "PROFILE_DENIED";
const GENERIC_SECURITY_COMMAND_RE = /(?:^|\s)(?:nmap|nuclei|ffuf|gobuster|sqlmap|nikto|katana|subfinder|amass|httpx|naabu|traceroute|tracert|hping3|testssl|wafw00f)\b/i;

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function actionName(input = {}) {
  return String(input.action || "").trim().toLowerCase();
}

function targetForInput(input = {}) {
  return String(input.target || input.url || input.path || input.cwd || "").trim();
}

function validateInput(toolName, input) {
  const schema = schemaForTool(toolName);
  if (!schema || !input || typeof input !== "object" || Array.isArray(input)) return { ok: false, code: RESULT_CODES.INVALID_INPUT, error: "Input must be a JSON object" };
  const action = actionName(input);
  if (!action || !ACTIONS[toolName]?.includes(action)) return { ok: false, code: RESULT_CODES.UNKNOWN_ACTION, error: `Unsupported action for ${toolName}` };
  const allowed = new Set(["action", ...Object.keys(schema.properties || {})]);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, code: RESULT_CODES.INVALID_INPUT, error: `Unknown input field: ${unknown}` };
  for (const field of schema.required || []) {
    if (input[field] === undefined || input[field] === null || input[field] === "") return { ok: false, code: RESULT_CODES.INVALID_INPUT, error: `Missing required input: ${field}` };
  }
  const valueValidation = validateValue(input, schema, toolName);
  if (!valueValidation.ok) return valueValidation;
  return { ok: true, action };
}

function defaultPolicy() {
  return { allowed: true, requiresApproval: false, code: RESULT_CODES.OK, reason: "Allowed" };
}

function createUnifiedToolRouter({
  ports = {},
  policy = null,
  requestApproval = null,
  auditSink = null,
  stateStore = null,
  scopeVerifier = validateScopeDecision,
  scopeDecisionResolver = null,
  approvalVerifier = validateApprovalGrant,
  resultProjector = projectToolResult,
  operationFactory = createOperationContext,
} = {}) {
  const activeOperations = new Map();

  function emitAudit(entry) {
    if (typeof auditSink === "function") auditSink(entry);
  }

  function persistState(operation) {
    const snapshot = operation.snapshot();
    if (typeof stateStore?.save === "function") stateStore.save(snapshot);
    return snapshot;
  }

  function baseResult(operation, options) {
    return createToolResult({
      audit_id: operation.auditId,
      operation_id: operation.operationId,
      ...options,
    });
  }

  function deny(operation, code, summary, status = "denied", data = {}) {
    operation.transition(status, { code, summary });
    persistState(operation);
    return baseResult(operation, { status, code, summary, data, retryable: false });
  }

  const MANAGED_CONTROL_ACTIONS = new Set(["continue", "stop", "status"]);
  function isManagedControl(toolName, input) {
    return toolName === "run_test_case" && MANAGED_CONTROL_ACTIONS.has(String(input?.action || ""));
  }

  async function authorize(operation, toolName, input, profile, context) {
    if (isManagedControl(toolName, input)) {
      // Continuation controls don't re-issue fresh scope decisions or
      // approvals: the managed session revalidates scope expiry, hard
      // deadline, authorization/policy versions, budgets, and ownership on
      // the model-issued continue/stop. `status` performs no action.
      return { ok: true };
    }
    const decision = typeof policy === "function"
      ? await policy({ toolName, input, profile, context })
      : defaultPolicy();
    if (decision?.allowed === false && decision?.requiresApproval !== true) return { ok: false, result: deny(operation, decision.code || RESULT_CODES.SCOPE_DENIED, decision.reason || "Operation denied.") };
    if (SCOPE_REQUIRED_TOOLS.has(toolName)) {
      const scopeReference = context.scopeDecision || input.scope_decision_id;
      const scopeDecision = scopeReference && typeof scopeReference === "object"
        ? scopeReference
        : typeof scopeDecisionResolver === "function"
          ? await scopeDecisionResolver(scopeReference, { operation, input, context })
          : null;
      if (!scopeDecision || typeof scopeDecision !== "object") return { ok: false, result: deny(operation, RESULT_CODES.SCOPE_DENIED, "A bound scope decision is required before active execution.") };
      const validation = scopeVerifier(scopeDecision, {
        assessmentId: input.assessment_id,
        actorId: context.actorId,
        target: targetForInput(input),
        operationCategory: SCOPE_CATEGORIES[toolName] || toolName,
        operationInput: input,
      });
      if (!validation.ok) return { ok: false, result: deny(operation, validation.code || RESULT_CODES.SCOPE_DENIED, validation.error || "Scope decision is invalid.") };
    }
    if (decision?.requiresApproval === true) {
      operation.transition("awaiting_approval", { code: RESULT_CODES.APPROVAL_REQUIRED });
      persistState(operation);
      const grant = typeof requestApproval === "function" ? await requestApproval({ operationId: operation.operationId, auditId: operation.auditId, toolName, input, profile }) : null;
      if (!grant) return { ok: false, result: deny(operation, RESULT_CODES.APPROVAL_REQUIRED, "Operator approval is required before this operation can run.") };
      const approval = approvalVerifier(grant, {
        assessmentId: input.assessment_id,
        actorId: context.actorId,
        runId: context.runId,
        target: targetForInput(input),
        operationCategory: toolName === "run_test_case" ? "test_case" : toolName,
        testCategory: input.category,
      });
      if (!approval.ok) return { ok: false, result: deny(operation, approval.code || RESULT_CODES.APPROVAL_EXPIRED, approval.error || "Approval grant is invalid.") };
      operation.transition("approved", { grant_id: grant.grant_id });
      persistState(operation);
    }
    return { ok: true };
  }

  async function execute(toolName, input = {}, context = {}) {
    const profile = context.profile || "agent";
    let operation = null;
    operation = operationFactory({
      operationId: context.operationId || id("operation"),
      auditId: context.auditId || id("audit"),
      actorId: context.actorId || "agent",
      profile,
      toolName,
      input,
      target: targetForInput(input),
      category: toolName,
      workspace: context.workspace || "",
      model: context.model || "",
      deadline: context.deadline,
      abortSignal: context.abortSignal,
      scopeDecision: context.scopeDecision,
      auditSink: emitAudit,
      stateSink: () => persistState(operation),
    });
    activeOperations.set(operation.operationId, operation);
    try {
      const catalogName = String(toolName || "").trim();
      if (!PUBLIC_TOOL_NAMES.includes(catalogName)) return deny(operation, RESULT_CODES.UNKNOWN_TOOL, `Unknown unified tool: ${catalogName || "missing name"}`);
      if (!toolNamesForProfile(profile).includes(catalogName)) return deny(operation, PROFILE_DENIED, `${catalogName} is not available in ${profile} profile.`);
      const inputValidation = validateInput(catalogName, input);
      if (!inputValidation.ok) return deny(operation, inputValidation.code, inputValidation.error);
      if (catalogName === "exec_command" && GENERIC_SECURITY_COMMAND_RE.test(String(input.command || ""))) return deny(operation, RESULT_CODES.TYPED_VAPT_OPERATION_REQUIRED, "Target-directed security commands must use run_test_case or another typed VAPT operation.");
      if (operation.isCancelled()) return deny(operation, RESULT_CODES.OPERATION_CANCELLED, "Operation was cancelled before dispatch.", "cancelled");
      if (operation.isExpired()) return deny(operation, RESULT_CODES.OPERATION_TIMEOUT, "Operation deadline expired before dispatch.", "cancelled");
      const authorization = await authorize(operation, catalogName, input, profile, context);
      if (!authorization.ok) return authorization.result;
      operation.transition("dispatching");
      persistState(operation);
      const port = ports[catalogName];
      if (!port || typeof port.execute !== "function") return deny(operation, RESULT_CODES.ADAPTER_UNAVAILABLE, `No adapter is available for ${catalogName}.`, "unavailable");
      operation.throwIfCancelled();
      const rawResult = await port.execute(input, operation);
      operation.throwIfCancelled();
      // Managed continuation checkpoint: the process is still running and a
      // checkpoint token is returned for a later continue/stop. The operation
      // is persisted as non-terminal (checkpointed) so it survives the turn.
      if (rawResult && rawResult.continuation_required === true) {
        const cursor = operation.checkpoint();
        operation.transition("checkpointed", { code: rawResult.code || RESULT_CODES.PARTIAL, checkpoint_id: cursor.current, managed_operation_id: rawResult.managed_operation_id });
        persistState(operation);
        return resultProjector(rawResult, {
          operationId: operation.operationId,
          auditId: operation.auditId,
          evidenceRefs: operation.addEvidence(rawResult?.evidence_refs || rawResult?.evidenceRefs || []),
        });
      }
      const projected = resultProjector(rawResult || {}, {
        operationId: operation.operationId,
        auditId: operation.auditId,
        evidenceRefs: operation.addEvidence(rawResult?.evidence_refs || rawResult?.evidenceRefs || []),
      });
      operation.transition(projected.status, { code: projected.code, evidence_refs: projected.evidence_refs });
      persistState(operation);
      return projected;
    } catch (error) {
      const cancelled = error?.code === "OPERATION_CANCELLED" || operation.isCancelled();
      const timedOut = error?.code === "OPERATION_TIMEOUT" || operation.isExpired();
      return deny(operation, cancelled ? RESULT_CODES.OPERATION_CANCELLED : timedOut ? RESULT_CODES.OPERATION_TIMEOUT : RESULT_CODES.ADAPTER_FAILED, cancelled ? "Operation cancelled." : timedOut ? "Operation timed out." : String(error?.message || "Adapter execution failed."), cancelled || timedOut ? "cancelled" : "failed");
    } finally {
      operation.markCleanup({ completed: true });
      activeOperations.delete(operation.operationId);
    }
  }

  async function resume(operationId, context = {}) {
    const operation = activeOperations.get(operationId);
    if (operation) {
      if (operation.status !== "awaiting_approval") return baseResult(operation, { status: "failed", code: RESULT_CODES.OPERATION_RESUME_DUPLICATE, summary: "Operation is not awaiting approval." });
      return execute(operation.toolName, operation.input, { ...context, operationId: operation.operationId, auditId: operation.auditId });
    }
    if (typeof stateStore?.load !== "function") return createToolResult({ status: "failed", code: RESULT_CODES.OPERATION_RESUME_DUPLICATE, summary: "Operation is not resumable." });
    const state = await stateStore.load(operationId, context.workspace || "");
    const validation = validateOperationState(state);
    if (!validation.ok || state.state === "terminal" || state.state === "dispatching") return createToolResult({ status: "failed", code: RESULT_CODES.OPERATION_RESUME_DUPLICATE, summary: "Operation cannot be resumed." });
    if (state.state !== "awaiting_approval" || !state.toolName || !state.input) return createToolResult({ status: "failed", code: RESULT_CODES.OPERATION_RESUME_DUPLICATE, summary: "Operation is not awaiting resumable approval." });
    return execute(state.toolName, state.input, { ...context, workspace: context.workspace || state.workspace, operationId: state.operationId, auditId: state.auditId, actorId: context.actorId || state.actorId });
  }

  function cancel(operationId) {
    const operation = activeOperations.get(operationId);
    if (!operation) return { ok: false, code: "OPERATION_NOT_FOUND" };
    operation.cancel();
    operation.record("cancel_requested", { code: RESULT_CODES.OPERATION_CANCELLED });
    persistState(operation);
    return { ok: true, operation_id: operationId, state: operation.snapshot() };
  }

  return Object.freeze({ execute, resume, cancel, activeOperations, ACTIONS });
}

module.exports = { ACTIONS, validateInput, createUnifiedToolRouter, ACTIVE_TOOLS };
