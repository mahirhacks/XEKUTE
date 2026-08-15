"use strict";

const { createAuthorityRegistry } = require("./authority-registry.js");
const { createAuthorityProfileResolver } = require("./gates/authority-profile-resolver.js");
const { createRoleAccessGate } = require("./gates/role-access-gate.js");
const { createRequestValidationGate } = require("./gates/request-validation-gate.js");
const { createScopeBasedGate } = require("./gates/scope-based-gate.js");
const { createAllowListGate } = require("./gates/allow-list-gate.js");
const { createDenyListGate } = require("./gates/deny-list-gate.js");
const { createIdentityContextGate } = require("./gates/identity-context-gate.js");
const { createRiskClassifierModule } = require("./gates/risk-classifier-module.js");
const { createAuthorityPolicyGate } = require("./gates/authority-policy-gate.js");
const { createApprovalGate } = require("./gates/approval-gate.js");
const { createEnvironmentGate } = require("./gates/environment-gate.js");
const { createResourceLimitGate } = require("./gates/resource-limit-gate.js");
const { createConcurrencyCoordinator, createConcurrencyGate } = require("./gates/concurrency-gate.js");
const { createTimeoutModule } = require("./gates/timeout-module.js");
const { createExecutionMonitorModule } = require("./gates/execution-monitor-module.js");
const { createOutputControlGate } = require("./gates/output-control-gate.js");
const { createVerificationModule } = require("./gates/verification-module.js");
const { createRecoveryModule } = require("./gates/recovery-module.js");
const { createRollbackModule } = require("./gates/rollback-module.js");
const { createAuditModule } = require("./gates/audit-module.js");
const { registerProductionProfiles } = require("./profiles/production-profiles.js");

function createAuthorityComposition({ evaluateScope, fsImpl } = {}) {
  const registry = createAuthorityRegistry();
  for (const adapter of [
    createAuthorityProfileResolver(),
    createRoleAccessGate(),
    createRequestValidationGate(),
    createScopeBasedGate({ evaluateScope }),
    createAllowListGate(),
    createDenyListGate(),
    createIdentityContextGate(),
    createRiskClassifierModule(),
    createAuthorityPolicyGate(),
    createApprovalGate(),
    createEnvironmentGate({ fsImpl }),
    createResourceLimitGate(),
    createConcurrencyGate(),
    createTimeoutModule(),
    createExecutionMonitorModule(),
    createOutputControlGate(),
    createVerificationModule(),
    createRecoveryModule(),
    createRollbackModule(),
    createAuditModule(),
  ]) registry.registerModule(adapter);
  registerProductionProfiles(registry);
  return { registry, concurrency: createConcurrencyCoordinator() };
}

module.exports = { createAuthorityComposition };
