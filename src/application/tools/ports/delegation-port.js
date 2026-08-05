"use strict";

const SPECIALISTS = new Set(["browser_mapping", "request_breaking", "logic_analysis", "penetration_testing", "network_analysis"]);

function intersectCapabilities(parent = {}, requested = {}) {
  return {
    specialist: SPECIALISTS.has(requested.specialist) ? requested.specialist : "",
    max_depth: Math.min(Number(parent.max_depth ?? 0), Number(requested.max_depth ?? 0)),
    max_parallel: Math.min(Number(parent.max_parallel ?? 1), Number(requested.max_parallel ?? 1)),
    max_runtime_ms: Math.min(Number(parent.max_runtime_ms ?? 1000), Number(requested.max_runtime_ms ?? 1000)),
    selected_context: (Array.isArray(parent.selected_context) ? parent.selected_context : []).filter((id) => (requested.selected_context || []).includes(id)).slice(0, 100),
  };
}

function createDelegationPort({ runner = null } = {}) {
  async function execute(input, context) {
    if (!SPECIALISTS.has(input.specialist)) return { ok: false, error: "Specialist type is not allowed.", code: "SPECIALIST_INVALID" };
    const capabilities = intersectCapabilities(context.delegation || {}, input);
    if (!capabilities.specialist || capabilities.max_depth < 0 || capabilities.max_parallel < 1) return { ok: false, error: "Delegation exceeds parent capability intersection.", code: "DELEGATION_CAPABILITY_DENIED" };
    if (!runner || typeof runner.execute !== "function") return { ok: false, unavailable: true, code: "DELEGATION_UNAVAILABLE", error: "Specialist delegation is unavailable." };
    try {
      const result = await runner.execute({ ...input, capabilities }, context);
      return { ok: true, summary: result?.summary || "Delegated operation completed.", evidence_refs: result?.evidence_refs || [], delegation: { specialist: capabilities.specialist, max_depth: capabilities.max_depth } };
    } catch (error) {
      return { ok: false, error: error.message, code: "DELEGATION_FAILED", parent_state_preserved: true };
    }
  }
  return Object.freeze({ execute, intersectCapabilities });
}

module.exports = { SPECIALISTS, intersectCapabilities, createDelegationPort };
