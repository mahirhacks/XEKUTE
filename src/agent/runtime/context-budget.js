"use strict";

/*
 * Provider-neutral context budgeting.  OpenRouter exposes a model maximum;
 * XEKUTE owns the smaller working budget used for prompt fitting and memory
 * compaction.  Keeping this logic in one module prevents the renderer,
 * controller, and provider adapters from disagreeing about what the meter
 * means.
 */

(function exposeContextBudget(globalScope, factory) {
  const value = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = value;
  if (globalScope) globalScope.XekuteContextBudget = value;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const FALLBACK_CONTEXT_TOKENS = 4096;
  const MIN_CONTEXT_TOKENS = 2048;
  const MAX_CONTEXT_TOKENS = 1_048_576;
  const MIN_RESPONSE_RESERVE = 1024;
  // The response reserve is not hard-capped: it scales with the context
  // window (10%) up to the model's own max completion, so large-context
  // models get a proportionally large output budget (unlimited by default).
  const MAX_RESPONSE_RESERVE = 262_144;
  const MAX_SAFETY_MARGIN = 2048;
  const REASONING_EFFORT_ORDER = Object.freeze([
    "max",
    "xhigh",
    "high",
    "medium",
    "low",
    "minimal",
    "none",
  ]);

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function estimateTokenCount(text) {
    if (!text) return 0;
    const value = String(text);
    const cjk = (value.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const pieces = value.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\sA-Za-z0-9_]/g) || [];
    const symbols = (value.match(/[{}()[\].,;:+\-*/=<>"'`|&!?]/g) || []).length * 0.15;
    const lines = (value.match(/\n/g) || []).length * 0.35;
    return Math.max(1, Math.ceil(cjk + (pieces.length - cjk) * 1.05 + symbols + lines));
  }

  function contextKey(provider, model) {
    return `${String(provider || "ollama").toLowerCase()}:${String(model || "").trim()}`;
  }

  function normalizeReasoningEffort(value) {
    const effort = String(value || "").trim().toLowerCase();
    return REASONING_EFFORT_ORDER.includes(effort) ? effort : null;
  }

  function normalizeReasoningMetadata(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const raw = source.reasoning && typeof source.reasoning === "object"
      ? source.reasoning
      : null;
    const supportedParameters = Array.isArray(source.supportedParameters)
      ? source.supportedParameters
      : Array.isArray(source.supported_parameters)
        ? source.supported_parameters
        : [];
    const supportsReasoningParameter = supportedParameters
      .map((value) => String(value).trim().toLowerCase())
      .some((value) => value === "reasoning" || value === "include_reasoning");
    if (!raw && !supportsReasoningParameter) return null;

    const hasSupportedEfforts = raw && (
      Object.prototype.hasOwnProperty.call(raw, "supported_efforts")
      || Object.prototype.hasOwnProperty.call(raw, "supportedEfforts")
    );
    const rawEfforts = raw && Object.prototype.hasOwnProperty.call(raw, "supported_efforts")
      ? raw.supported_efforts
      : raw?.supportedEfforts;
    const supportedEfforts = rawEfforts === null
      ? [...REASONING_EFFORT_ORDER]
      : Array.isArray(rawEfforts)
        ? REASONING_EFFORT_ORDER.filter((effort) => rawEfforts.some((value) => normalizeReasoningEffort(value) === effort))
        : [];
    const defaultEffort = normalizeReasoningEffort(raw?.default_effort ?? raw?.defaultEffort);
    const defaultEnabled = typeof raw?.default_enabled === "boolean"
      ? raw.default_enabled
      : typeof raw?.defaultEnabled === "boolean"
        ? raw.defaultEnabled
        : null;
    const supportsMaxTokens = raw?.supports_max_tokens === true || raw?.supportsMaxTokens === true;
    const mandatory = raw?.mandatory === true;

    return {
      available: true,
      selectable: hasSupportedEfforts === true && (rawEfforts === null || supportedEfforts.length > 0),
      supportedEfforts,
      defaultEffort,
      defaultEnabled,
      supportsMaxTokens,
      mandatory,
    };
  }

  function normalizeModelMetadata(input = {}, fallbackId = "") {
    const source = input && typeof input === "object" ? input : {};
    const contextWindowTokens = positiveInteger(
      source.contextWindowTokens
      ?? source.contextLength
      ?? source.context_length
      ?? source.topProviderContextLength
      ?? source.top_provider?.context_length,
    );
    const maxCompletionTokens = positiveInteger(
      source.maxCompletionTokens
      ?? source.maxOutputTokens
      ?? source.max_completion_tokens
      ?? source.max_output_length
      ?? source.topProviderMaxCompletionTokens
      ?? source.top_provider?.max_completion_tokens,
    );
    const id = String(source.id || source.model || fallbackId || "").trim();
    return {
      provider: String(source.provider || "openrouter").toLowerCase(),
      id,
      name: String(source.name || id).trim() || id,
      contextWindowTokens,
      maxCompletionTokens,
      endpointContextLengths: Array.isArray(source.endpointContextLengths)
        ? [...new Set(source.endpointContextLengths.map(positiveInteger).filter(Boolean))].sort((a, b) => b - a)
        : Array.isArray(source.contextLengths)
          ? [...new Set(source.contextLengths.map(positiveInteger).filter(Boolean))].sort((a, b) => b - a)
          : [],
      supportedParameters: Array.isArray(source.supportedParameters)
        ? [...new Set(source.supportedParameters.map(String))]
        : Array.isArray(source.supported_parameters)
          ? [...new Set(source.supported_parameters.map(String))]
          : [],
      reasoning: normalizeReasoningMetadata(source),
      source: String(source.source || (contextWindowTokens ? "catalog" : "fallback")),
      fetchedAt: String(source.fetchedAt || ""),
      approximate: Boolean(source.approximate || !contextWindowTokens),
    };
  }

  function legacyContextLabelToTokens(value) {
    if (value == null || value === "" || value === "Auto") return null;
    const direct = positiveInteger(value);
    if (direct) return direct;
    const match = /^(\d+(?:\.\d+)?)K$/i.exec(String(value).trim());
    return match ? positiveInteger(Number(match[1]) * 1024) : null;
  }

  function tokensToContextLabel(value) {
    const tokens = positiveInteger(value);
    if (!tokens) return "Auto";
    if (tokens % 1024 === 0) return `${tokens / 1024}K`;
    return String(tokens);
  }

  function normalizePreference(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const legacy = legacyContextLabelToTokens(source.context);
    const explicit = positiveInteger(source.limitTokens ?? source.contextLimitTokens ?? legacy);
    const mode = source.mode === "custom"
      || source.contextLocked === true
      || (source.context && source.context !== "Auto" && source.context !== "8K")
      ? "custom"
      : "auto";
    return {
      mode,
      limitTokens: mode === "custom" ? explicit : null,
    };
  }

  function responseReserveFor(limitTokens, maxCompletionTokens) {
    const limit = positiveInteger(limitTokens) || FALLBACK_CONTEXT_TOKENS;
    const percentage = Math.floor(limit * 0.10);
    const quarter = Math.floor(limit * 0.25);
    let reserve = clamp(percentage, Math.min(MIN_RESPONSE_RESERVE, quarter), Math.min(MAX_RESPONSE_RESERVE, quarter));
    if (maxCompletionTokens) return Math.min(maxCompletionTokens, Math.max(256, reserve));
    return Math.max(256, reserve);
  }

  function resolveContextPlan({ provider = "ollama", model = "", metadata = {}, preference = {}, runtime = null } = {}) {
    const normalizedMetadata = normalizeModelMetadata(metadata, model);
    const normalizedPreference = normalizePreference(preference);
    const runtimeContext = positiveInteger(runtime?.contextLength ?? runtime?.contextWindowTokens);
    const catalogContext = positiveInteger(normalizedMetadata.contextWindowTokens);
    const knownMaximum = runtimeContext || catalogContext;
    const fallback = FALLBACK_CONTEXT_TOKENS;
    const requested = normalizedPreference.mode === "custom" ? normalizedPreference.limitTokens : null;
    const upperBound = knownMaximum ? Math.max(MIN_CONTEXT_TOKENS, knownMaximum) : MAX_CONTEXT_TOKENS;
    const effectiveLimitTokens = clamp(
      requested || knownMaximum || fallback,
      MIN_CONTEXT_TOKENS,
      upperBound,
    );
    const responseReserveTokens = responseReserveFor(effectiveLimitTokens, normalizedMetadata.maxCompletionTokens);
    const safetyMarginTokens = clamp(Math.floor(effectiveLimitTokens * 0.02), 256, MAX_SAFETY_MARGIN);
    const promptBudgetTokens = Math.max(
      512,
      effectiveLimitTokens - responseReserveTokens - safetyMarginTokens,
    );
    const source = normalizedPreference.mode === "custom"
      ? "manual"
      : runtimeContext
        ? "runtime"
        : catalogContext
          ? normalizedMetadata.source || "catalog"
          : "fallback";
    return {
      provider: String(provider || normalizedMetadata.provider || "ollama").toLowerCase(),
      model: String(model || normalizedMetadata.id || "").trim(),
      mode: normalizedPreference.mode,
      modelMaxTokens: knownMaximum || null,
      effectiveLimitTokens,
      promptBudgetTokens,
      responseReserveTokens,
      safetyMarginTokens,
      maxCompletionTokens: normalizedMetadata.maxCompletionTokens || null,
      source,
      approximate: !knownMaximum || Boolean(normalizedMetadata.approximate && !runtimeContext),
      metadata: normalizedMetadata,
    };
  }

  function roundContextTokens(tokens, maximum) {
    const limit = positiveInteger(maximum) || tokens;
    const rounded = Math.ceil(tokens / 1000) * 1000;
    return Math.min(limit, Math.max(MIN_CONTEXT_TOKENS, rounded));
  }

  function contextOptions(maximum) {
    const limit = positiveInteger(maximum) || MAX_CONTEXT_TOKENS;
    const values = [1, 2, 3]
      .map((divisor) => Math.floor(limit / divisor))
      .filter((value) => value >= MIN_CONTEXT_TOKENS)
      .map((value) => roundContextTokens(value, limit));
    if (!values.length && limit >= MIN_CONTEXT_TOKENS) values.push(limit);
    return [...new Set(values)];
  }

  return {
    FALLBACK_CONTEXT_TOKENS,
    MIN_CONTEXT_TOKENS,
    MAX_CONTEXT_TOKENS,
    REASONING_EFFORT_ORDER,
    contextKey,
    contextOptions,
    estimateTokenCount,
    legacyContextLabelToTokens,
    normalizeModelMetadata,
    normalizeReasoningEffort,
    normalizeReasoningMetadata,
    normalizePreference,
    positiveInteger,
    resolveContextPlan,
    responseReserveFor,
    tokensToContextLabel,
  };
});
