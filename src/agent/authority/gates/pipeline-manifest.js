"use strict";

const MODULE_ORDER = Object.freeze([
  "role_access_gate",
  "request_validation_gate",
  "scope_based_gate",
  "allow_list_gate",
  "deny_list_gate",
  "identity_context_gate",
  "risk_classifier_module",
  "authority_policy_gate",
  "approval_gate",
  "environment_gate",
  "resource_limit_gate",
  "concurrency_gate",
  "timeout_module",
  "execution_monitor_module",
  "output_control_gate",
  "verification_module",
  "recovery_module",
  "rollback_module",
  "audit_module",
]);

module.exports = Object.freeze({ status: "active", bootstrap: "authority_profile_resolver", moduleOrder: MODULE_ORDER, activeRuntimePolicy: "scope+identity+plan+authority+lifecycle", longHorizon: true });
