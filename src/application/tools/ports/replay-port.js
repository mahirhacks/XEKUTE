"use strict";

const { validateIdentityDescriptor } = require("../../../contracts/tool/identity");

function createReplayPort({ securityHttpWorkbench, identityPort, scopePort } = {}) {
  async function execute(input, context) {
    if (!securityHttpWorkbench?.run) return { ok: false, unavailable: true, code: "ADAPTER_UNAVAILABLE", error: "HTTP replay adapter is unavailable." };
    if (typeof scopePort?.resolve === "function" && !scopePort.resolve(context, input.scope_decision_id)) return { ok: false, error: "Scope decision was not found.", code: "SCOPE_DECISION_NOT_FOUND" };
    if (identityPort?.describe) {
      const identity = await identityPort.execute({ action: "describe", assessment_id: input.assessment_id, identity_id: input.identity_id }, context);
      const validation = validateIdentityDescriptor(identity.identity, { assessmentId: input.assessment_id });
      if (!validation.ok) return validation;
    }
    const result = await securityHttpWorkbench.run({ assessmentPath: context.workspace, rawRequest: input.request || input.request_id, mode: "repeater" });
    if (result.error) return result;
    return { ok: true, status: result.status, duration_ms: result.durationMs, response_fingerprint: `sha256:${require("node:crypto").createHash("sha256").update(String(result.response || "")).digest("hex")}`, artifact_refs: result.logged?.evidence?.id ? [result.logged.evidence.id] : [] };
  }
  return Object.freeze({ execute });
}

module.exports = { createReplayPort };
