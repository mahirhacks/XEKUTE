"use strict";

function createInvocationState({ invocationId = "", request = null } = {}) {
  return {
    invocationId: String(invocationId),
    request,
    normalizedArguments: null,
    normalizedTargets: [],
    profile: null,
    decisions: [],
    scope: null,
    scopeDecision: "",
    allowList: null,
    denyList: null,
    identity: null,
    risk: null,
    restrictions: [],
    resourceLimits: null,
    resourceUsage: null,
    concurrencyClaims: [],
    timeoutPolicy: null,
    monitorState: null,
    rawResult: null,
    controlledResult: null,
    verification: null,
    recovery: null,
    rollback: null,
    auditEvents: [],
    startedAt: new Date().toISOString(),
    completedAt: "",
  };
}

function recordDecision(state, value) {
  state.decisions.push(value);
  if (Array.isArray(value?.restrictions)) state.restrictions.push(...value.restrictions);
  return value;
}

module.exports = { createInvocationState, recordDecision };
