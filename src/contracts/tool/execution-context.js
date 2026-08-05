"use strict";

const crypto = require("node:crypto");

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createExecutionContext({
  operationId = id("operation"),
  auditId = id("audit"),
  abortSignal = null,
  deadline = null,
  scopeDecision = null,
  actorId = "agent",
  profile = "agent",
  target = "",
  category = "",
  workspace = "",
  model = "",
} = {}) {
  const resolvedDeadline = deadline == null ? null : Number(deadline);
  const controller = abortSignal ? null : new AbortController();
  const signal = abortSignal || controller.signal;
  const context = {
    operationId: String(operationId),
    auditId: String(auditId),
    actorId: String(actorId || "agent"),
    profile: String(profile || "agent"),
    target: String(target || ""),
    category: String(category || ""),
    workspace: String(workspace || ""),
    model: String(model || ""),
    abortSignal: signal,
    deadline: Number.isFinite(resolvedDeadline) ? resolvedDeadline : null,
    scopeDecision: scopeDecision || null,
  };
  return Object.freeze({
    ...context,
    isCancelled() { return Boolean(context.abortSignal?.aborted); },
    isExpired(now = Date.now()) { return context.deadline != null && now >= context.deadline; },
    remainingMs(now = Date.now()) {
      if (context.deadline == null) return null;
      return Math.max(0, context.deadline - now);
    },
    cancel() {
      if (controller) controller.abort();
      else if (context.abortSignal && !context.abortSignal.aborted && typeof context.abortSignal.dispatchEvent === "function") context.abortSignal.dispatchEvent(new Event("abort"));
    },
    throwIfCancelled(now = Date.now()) {
      if (context.abortSignal?.aborted) {
        const error = new Error("Operation cancelled");
        error.code = "OPERATION_CANCELLED";
        throw error;
      }
      if (context.deadline != null && now >= context.deadline) {
        const error = new Error("Operation deadline exceeded");
        error.code = "OPERATION_TIMEOUT";
        throw error;
      }
    },
    child(overrides = {}) {
      return createExecutionContext({ ...context, ...overrides });
    },
  });
}

module.exports = { createExecutionContext, id };
