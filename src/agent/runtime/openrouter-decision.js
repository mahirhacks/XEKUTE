"use strict";

const DEFAULT_TIMEOUT_MS = 20_000;

async function runOpenRouterDecision({
  model,
  state,
  questions,
  baseUrl,
  apiKey,
  headers = {},
  fetchImpl = globalThis.fetch,
  signal = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const selectedModel = String(model || "").trim();
  if (!String(apiKey || "").trim()) throw Object.assign(new Error("OpenRouter API key is not configured."), { code: "OPENROUTER_KEY_REQUIRED" });
  if (!selectedModel || !state || typeof state !== "object" || Array.isArray(state)
    || !questions || typeof questions !== "object" || Array.isArray(questions) || !Object.keys(questions).length
    || typeof fetchImpl !== "function") {
    throw Object.assign(new Error("The routing decision request is invalid."), { code: "SKILL_ROUTER_REQUEST_INVALID" });
  }
  if (signal?.aborted) throw Object.assign(new Error("The routing decision was cancelled."), { code: "SKILL_ROUTER_CANCELLED", aborted: true });

  const controller = new AbortController();
  const stop = () => controller.abort(signal?.reason || "SKILL_ROUTER_CANCELLED");
  const timeout = setTimeout(() => controller.abort("SKILL_ROUTER_TIMEOUT"), Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  signal?.addEventListener?.("abort", stop, { once: true });
  try {
    const endpoint = new URL("/api/alpha/decisions", baseUrl).toString();
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { ...headers, Authorization: headers.Authorization || `Bearer ${String(apiKey).trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: selectedModel, state, questions }),
      signal: controller.signal,
    });
    let body = {};
    try { body = await response.json(); } catch { /* response validation below reports malformed JSON */ }
    if (!response.ok) {
      const detail = body?.error?.message || body?.error?.metadata?.error_type || `OpenRouter decision error: ${response.status}`;
      throw Object.assign(new Error(String(detail)), { code: "SKILL_ROUTER_HTTP" });
    }
    if (!body?.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) {
      throw Object.assign(new Error("OpenRouter returned an invalid decision response."), { code: "SKILL_ROUTER_RESPONSE_INVALID" });
    }
    const questionIds = Object.keys(questions);
    const answerIds = Object.keys(body.answers);
    if (answerIds.length !== questionIds.length || answerIds.some((id) => !Object.hasOwn(questions, id))) {
      throw Object.assign(new Error("OpenRouter returned an incomplete or unexpected decision set."), { code: "SKILL_ROUTER_RESPONSE_INVALID" });
    }
    for (const id of questionIds) {
      const answer = body.answers[id];
      if (answer?.type !== "noul" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
        throw Object.assign(new Error(`OpenRouter returned an invalid score for ${id}.`), { code: "SKILL_ROUTER_RESPONSE_INVALID" });
      }
    }
    return body;
  } catch (error) {
    if (signal?.aborted || controller.signal.reason === "SKILL_ROUTER_CANCELLED") {
      throw Object.assign(new Error("The routing decision was cancelled."), { code: "SKILL_ROUTER_CANCELLED", aborted: true });
    }
    if (controller.signal.aborted) throw Object.assign(new Error("The routing decision timed out."), { code: "SKILL_ROUTER_TIMEOUT" });
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", stop);
  }
}

module.exports = Object.freeze({ DEFAULT_TIMEOUT_MS, runOpenRouterDecision });
