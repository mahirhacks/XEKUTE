"use strict";

/** Keep model-facing tool results bounded and stable across adapters. */
function toolResultContentForModel(result) {
  const value = result?.value && typeof result.value === "object" ? result.value : {};
  const data = result?.data && typeof result.data === "object" ? result.data : {};
  const preferred = { ...data, ...value };
  const payload = Object.keys(preferred).length
    ? preferred
    : Object.fromEntries(Object.entries(result && typeof result === "object" ? result : {}).filter(([key]) => !["ok", "status", "error", "errorCode", "code", "evidenceIds", "evidence_refs", "activeTools"].includes(key)));
  if (Array.isArray(result?.activeTools)) payload.activatedMcpTools = result.activeTools.map((tool) => tool?.function?.name).filter(Boolean).slice(0, 50);
  return JSON.stringify({
    ok: result?.ok === true || result?.status === "success" || result?.status === "partial",
    status: result?.status || "",
    error: result?.error || "",
    errorCode: result?.errorCode || result?.code || "",
    evidenceIds: result?.evidenceIds || result?.evidence_refs || value.evidenceIds || [],
    payload: JSON.stringify(payload).slice(0, 32_000),
  });
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
