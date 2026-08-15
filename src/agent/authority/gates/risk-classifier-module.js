"use strict";

const { allow, gate } = require("./gate-utils.js");

function classifyRisk({ toolName, args = {}, entry = null } = {}) {
  const operation = String(args?.operation || args?.action || "").toLowerCase();
  const method = String(args?.method || args?.request?.method || "GET").toUpperCase();
  const repetitions = Number(args?.execution?.repetitions || args?.repetitions || 1);
  const dimensions = [];
  const add = (id, score, reason) => { if (score > 0) dimensions.push({ id, score, reason }); };
  const observationalExec = toolName === "exec_command" && ["status", "list"].includes(operation);
  add("mutation", entry?.metadata?.mutating && !observationalExec ? 2 : 0, "The tool can change project or target state.");
  add("irreversibility", entry?.metadata?.reversible === false && !observationalExec ? 2 : 0, "The capability has no deterministic rollback contract.");
  add("process_execution", toolName === "exec_command" && !observationalExec ? 2 : 0, "Arbitrary local process execution can have broad effects.");
  add("destructive_operation", /^(delete|remove|stop|terminate|drop|reset)$/.test(operation) ? 3 : 0, "The selected operation deletes or terminates state.");
  add("network_state_change", ["POST", "PUT", "PATCH", "DELETE"].includes(method) || (toolName === "browser_action" && ["click", "type", "select"].includes(operation)) ? 2 : 0, "The action may modify remote application state.");
  add("parallelism", repetitions > 1 || String(args?.execution?.mode || "") === "barrier" ? (repetitions > 10 ? 2 : 1) : 0, "Repeated or synchronized execution increases operational impact.");
  add("authenticated_context", args?.identityId || args?.testCase?.steps?.some?.((step) => step?.identityId) ? 1 : 0, "The action uses an authenticated identity.");
  const sensitiveKeys = JSON.stringify(args, (key, value) => /password|token|secret|authorization|cookie/i.test(key) ? "[present]" : value);
  add("sensitive_input", /\[present\]/.test(sensitiveKeys) ? 2 : 0, "Sensitive input fields are present.");
  const score = Math.min(10, dimensions.reduce((sum, item) => sum + item.score, 0));
  const level = score >= 6 ? "high" : score >= 3 ? "medium" : "low";
  return { level, score, reasons: dimensions.map((item) => item.reason), dimensions, reversible: entry?.metadata?.reversible !== false };
}

function createRiskClassifierModule() {
  return gate("risk_classifier_module", ({ toolName, args, entry, state }) => {
    state.risk = classifyRisk({ toolName, args, entry });
    return allow("risk_classifier_module", `Risk classified as ${state.risk.level}.`, { risk: state.risk });
  });
}

module.exports = { classifyRisk, createRiskClassifierModule };
