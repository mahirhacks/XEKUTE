"use strict";

function createToolDispatcher({ registry, scopeEvaluator = null, executor } = {}) {
  if (!registry || typeof registry.get !== "function") throw new TypeError("registry is required");
  if (typeof executor !== "function") throw new TypeError("executor is required");
  return async function dispatch({ workspace, toolCall, projectProfile = null } = {}) {
    const name = toolCall?.function?.name || toolCall?.toolName || "";
    if (!registry.get(name)) return { ok: false, error: `Unknown tool '${name}'`, code: "UNKNOWN_TOOL" };
    if (typeof scopeEvaluator === "function") {
      const scope = scopeEvaluator({ workspace, toolName: name, args: toolCall?.function?.arguments || {}, projectProfile });
      if (!scope.ok) return { ok: false, error: scope.reason, code: scope.code, scope, retryable: false };
    }
    return executor({ workspace, toolCall });
  };
}

module.exports = { createToolDispatcher };
