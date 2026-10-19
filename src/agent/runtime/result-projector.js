"use strict";

const { neutralizeContextMarkers } = require("../../shared/context-markers.js");

function boundedPayload(payload, limit = 32_000) {
  const cloned = JSON.parse(JSON.stringify(payload));
  let serialized = JSON.stringify(cloned);
  if (serialized.length <= limit) return serialized;
  cloned.projectionTruncated = true;
  for (let attempt = 0; attempt < 200 && serialized.length > limit; attempt++) {
    let largest = null;
    function visit(value) {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "screenshot") continue;
        if ((typeof child === "string" && child.length > 160) || (Array.isArray(child) && child.length > 1)) {
          const size = JSON.stringify(child).length;
          if (!largest || size > largest.size) largest = { parent: value, key, value: child, size };
        }
        visit(child);
      }
    }
    visit(cloned);
    if (!largest) break;
    largest.parent[largest.key] = typeof largest.value === "string"
      ? largest.value.slice(0, Math.floor(largest.value.length / 2)) + "\n[truncated]"
      : largest.value.slice(0, Math.ceil(largest.value.length / 2));
    serialized = JSON.stringify(cloned);
  }
  return serialized.length <= limit ? serialized : JSON.stringify({ projectionTruncated: true, error: "Tool result exceeds the model projection limit. Request a smaller result." });
}

/** Keep model-facing tool results bounded and stable across adapters. */
// Tool output is untrusted text the model reads, so look-alike context markers
// in it are neutralized (see shared/context-markers.js).
function toolResultContentForModel(result) {
  const value = result?.value && typeof result.value === "object" ? result.value : {};
  const data = result?.data && typeof result.data === "object" ? result.data : {};
  const preferred = { ...data, ...value };
  const payload = Object.keys(preferred).length
    ? preferred
    : Object.fromEntries(Object.entries(result && typeof result === "object" ? result : {}).filter(([key]) => !["ok", "status", "error", "errorCode", "code", "evidenceIds", "evidence_refs", "activeTools"].includes(key)));
  if (Array.isArray(result?.activeTools)) payload.activatedMcpTools = result.activeTools.map((tool) => tool?.function?.name).filter(Boolean).slice(0, 50);
  return neutralizeContextMarkers(JSON.stringify({
    ok: result?.ok === true || result?.status === "success" || result?.status === "partial",
    status: result?.status || "",
    error: result?.error || "",
    errorCode: result?.errorCode || result?.code || "",
    evidenceIds: result?.evidenceIds || result?.evidence_refs || value.evidenceIds || [],
    payload: boundedPayload(payload),
  }));
}

function projectToolResult(result) {
  return {
    ok: result?.ok === true || result?.status === "success" || result?.status === "partial",
    status: result?.status || "",
    error: result?.error || "",
    code: result?.errorCode || result?.code || "",
    evidenceIds: result?.evidenceIds || result?.evidence_refs || result?.value?.evidenceIds || [],
    data: result?.data || result?.value || {},
  };
}

module.exports = { toolResultContentForModel, projectToolResult };
