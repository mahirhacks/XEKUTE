"use strict";

const { createLifecycleResult } = require("../../contracts/tool/result-schema.js");
const { createInvocationState, recordDecision } = require("./invocation-state.js");
const { resolveAuthorityProfile } = require("./gates/authority-profile-resolver.js");
const { runMonitoredExecution } = require("./gates/execution-monitor-module.js");

const PRE_EXECUTION = new Set([
  "role_access_gate", "request_validation_gate", "scope_based_gate", "allow_list_gate", "deny_list_gate",
  "identity_context_gate", "risk_classifier_module", "authority_policy_gate", "approval_gate", "environment_gate",
  "resource_limit_gate", "concurrency_gate", "timeout_module", "execution_monitor_module",
]);
const POST_EXECUTION = new Set(["output_control_gate", "verification_module", "recovery_module", "rollback_module"]);

function codeFromDecision(value) { return value?.metadata?.code || (value?.moduleName === "approval_gate" ? "APPROVAL_DENIED" : "AUTHORITY_DENIED"); }
function outcomeFromRaw(result, verification) {
  if (verification?.status === "partial") return "partial";
  if (result?.ok === false || result?.error) return "failure";
  if (result?.ok === true) return "success";
  return "inconclusive";
}

function createInvocationPipeline({ authorityRegistry, concurrency } = {}) {
  if (!authorityRegistry) throw new TypeError("authorityRegistry is required");
  async function invoke({ context, toolName, args = {}, entry, execute, signal = null, runtime = {} } = {}) {
    const state = createInvocationState({ invocationId: context?.invocationId, request: { toolName, args } });
    const resolved = resolveAuthorityProfile(authorityRegistry, context?.authority);
    if (!resolved.ok) return { ok: false, outcome: "failure", code: resolved.code, error: resolved.error, invocationId: context?.invocationId || "" };
    state.profile = resolved.profile;
    const auditEvent = (stage, data = {}) => {
      const value = { type: "tool_invocation_event", stage, invocationId: context.invocationId, toolName, role: context.role, authority: resolved.profile.id, at: new Date().toISOString(), ...data };
      state.auditEvents.push(value);
      runtime.audit?.append?.(context.workspace?.root || "", value);
      runtime.onEvent?.(value);
      return value;
    };
    const resolver = authorityRegistry.module("authority_profile_resolver");
    if (!resolver) return { ok: false, outcome: "failure", code: "AUTHORITY_RESOLVER_UNAVAILABLE", error: "The authority profile resolver is unavailable.", invocationId: context?.invocationId || "" };
    const resolverDecision = await resolver.evaluate({ context, state, profile: resolved.profile, toolName, args, entry, runtime });
    recordDecision(state, resolverDecision);
    auditEvent("authority_profile_resolver", { profile: resolved.profile.id, decision: resolverDecision });

    let lease = null;
    let terminalDecision = null;
    let thrown = null;
    try {
      for (const adapter of resolved.pipeline) {
        if (!PRE_EXECUTION.has(adapter.name)) continue;
        const value = await adapter.evaluate({ context, state, profile: resolved.profile, toolName, args, entry, runtime });
        recordDecision(state, value);
        auditEvent(adapter.name, { decision: value });
        if (adapter.name === "authority_policy_gate" && !resolved.profile.modulePipeline.includes("approval_gate")) {
          auditEvent("approval_stage_skipped", { reason: "The resolved Full Authorization profile has no approval stage." });
        }
        if (value.terminal) { terminalDecision = value; break; }
      }

      if (!terminalDecision) {
        lease = await concurrency.acquireMany(
          state.concurrencyClaims || [],
          context.invocationId,
          signal,
          (details) => auditEvent("concurrency_queued", details),
        );
        state.rawResult = await runMonitoredExecution({
          context,
          state,
          signal,
          emit: (event) => auditEvent("execution_monitor_module", { monitorEvent: event }),
          checkpoint: runtime.checkpoint,
          execute: (monitorRuntime) => execute({
            ...monitorRuntime,
            // Reaching the execution stage means every pre-execution authority
            // gate allowed the invocation. This narrow, non-secret capability
            // is consumed only by trusted adapters such as Sensitive Working
            // Memory; the full decision trace stays inside the pipeline.
            authorityDecision: {
              ok: true,
              code: "AUTHORITY_PIPELINE_ALLOWED",
              policy: resolved.profile.id,
              invocationId: context.invocationId,
              toolName,
            },
          }),
        });
        for (const adapter of resolved.pipeline) {
          if (!POST_EXECUTION.has(adapter.name)) continue;
          const value = await adapter.evaluate({ context, state, profile: resolved.profile, toolName, args, entry, runtime });
          recordDecision(state, value);
          auditEvent(adapter.name, { decision: value });
        }
      }
    } catch (error) {
      thrown = error;
      state.rawResult = { ok: false, error: { code: error.code || "INVOCATION_PIPELINE_FAILED", message: error.message, retryable: false } };
      auditEvent("pipeline_exception", { code: error.code || "INVOCATION_PIPELINE_FAILED", error: error.message });
    } finally {
      if (lease) concurrency.release(lease);
      const audit = authorityRegistry.module("audit_module");
      if (audit) {
        const value = await audit.evaluate({ context, state, profile: resolved.profile, toolName, args, entry, runtime });
        recordDecision(state, value);
        const auditTrace = { type: "tool_invocation_event", stage: "audit_module", invocationId: context.invocationId, toolName, role: context.role, authority: resolved.profile.id, at: new Date().toISOString(), decision: value };
        state.auditEvents.push(auditTrace);
        runtime.onEvent?.(auditTrace);
      }
      state.completedAt = new Date().toISOString();
    }

    if (terminalDecision) {
      const code = codeFromDecision(terminalDecision);
      const terminalOutcome = terminalDecision.decision === "restrict"
        ? "restricted"
        : code === "APPROVAL_REQUIRED" ? "approval_required" : "denied";
      const lifecycle = createLifecycleResult({
        invocationId: context.invocationId,
        outcome: terminalOutcome,
        rawResult: { error: terminalDecision.reason },
        reason: terminalDecision.reason,
        restrictions: state.restrictions,
        verification: { status: "inconclusive", evidence: [], reason: "Execution did not begin." },
        recovery: { status: "recovery_selected", action: code.includes("SCOPE") ? "replan" : "escalate", reason: terminalDecision.reason, sourceOutcome: terminalOutcome, nextInvocationId: "", restrictions: state.restrictions, selectedAt: new Date().toISOString() },
        rollback: { status: "not_required", action: "", reason: "Execution did not begin.", restoredArtifacts: [], compensationReference: "", error: "", completedAt: "" },
        auditReference: state.auditReference,
        timestamps: { startedAt: state.startedAt, completedAt: state.completedAt },
      });
      return { ok: false, outcome: lifecycle.outcome, code, error: terminalDecision.reason, retryable: false, lifecycle, auditReference: state.auditReference };
    }

    const controlled = state.controlledResult && typeof state.controlledResult === "object" ? state.controlledResult : state.rawResult || {};
    const outcome = thrown ? "failure" : outcomeFromRaw(controlled, state.verification);
    const lifecycle = createLifecycleResult({
      invocationId: context.invocationId,
      outcome,
      rawResult: controlled,
      reason: state.verification?.reason || (thrown ? thrown.message : ""),
      restrictions: state.restrictions,
      executionMetadata: { monitor: state.monitorState, outputTransformation: state.outputTransformation },
      verification: state.verification || { status: "inconclusive", evidence: [], reason: "Lifecycle verification did not run." },
      recovery: state.recovery,
      rollback: state.rollback,
      auditReference: state.auditReference,
      timestamps: { startedAt: state.startedAt, completedAt: state.completedAt },
    });
    return { ...controlled, ok: outcome === "success", outcome, lifecycle, verification: state.verification, recovery: state.recovery, rollback: state.rollback, auditReference: state.auditReference, integrityHash: lifecycle.integrityHash };
  }
  return { invoke };
}

module.exports = { createInvocationPipeline };
