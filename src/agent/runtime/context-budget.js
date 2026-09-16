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
  const STANDARD_CONTEXT_TOKENS = Object.freeze([
    4_096,
    8_192,
    16_384,
    32_768,
    65_536,
    131_072,
    262_144,
    524_288,
    1_048_576,
    2_097_152,
  ]);
  const PICKER_STANDARD_TOKENS = Object.freeze([
    32_768,
    131_072,
    262_144,
    1_048_576,
  ]);
  const PICKER_CONTEXT_CHOICES = 3;
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
    const match = /^(\d+(?:\.\d+)?)([KM])$/i.exec(String(value).trim());
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2].toUpperCase();
    return unit === "M"
      ? positiveInteger(amount * 1_048_576)
      : positiveInteger(amount * 1024);
  }

  function tokensToContextLabel(value) {
    const tokens = positiveInteger(value);
    if (!tokens) return "Auto";
    if (tokens >= 1_048_576 && tokens % 1_048_576 === 0) return `${tokens / 1_048_576}M`;
    if (tokens % 1024 === 0) return `${tokens / 1024}K`;
    return String(tokens);
  }

  function snapContextWindowTokens(tokens) {
    const value = positiveInteger(tokens);
    if (!value) return null;
    const nearest = STANDARD_CONTEXT_TOKENS.reduce((best, candidate) => (
      Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
    ), STANDARD_CONTEXT_TOKENS[0]);
    return Math.abs(nearest - value) / Math.max(nearest, value) < 0.04
      ? nearest
      : value;
  }

  function formatContextWindowLabel(tokens) {
    const snapped = snapContextWindowTokens(tokens);
    if (!snapped) return "Auto";
    if (snapped >= 1_048_576 && snapped % 1_048_576 === 0) return `${snapped / 1_048_576}M`;
    if (snapped % 1024 === 0) {
      const kibi = snapped / 1024;
      if (kibi % 1024 === 0) return `${kibi / 1024}M`;
      return `${kibi}K`;
    }
    if (snapped >= 1_000_000) return `${Math.round(snapped / 1_000_000)}M`;
    if (snapped >= 1000) return `${Math.round(snapped / 1000)}K`;
    return String(snapped);
  }

  function formatPickerContextLabel(tokens) {
    const snapped = snapContextWindowTokens(tokens);
    if (!snapped) return "Auto";
    if (snapped === 262_144) return "262K";
    return formatContextWindowLabel(snapped);
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

  function contextOptions(maximum, extras = []) {
    const limit = positiveInteger(maximum);
    if (!limit) return [];
    const near = (left, right) => Math.abs(left - right) / Math.max(left, right) < 0.04;
    const values = STANDARD_CONTEXT_TOKENS.filter((value) => value >= MIN_CONTEXT_TOKENS && value <= limit);
    for (const extra of (Array.isArray(extras) ? extras : []).map(positiveInteger)) {
      if (!extra || extra < MIN_CONTEXT_TOKENS || extra > limit) continue;
      if (!values.some((value) => near(value, extra))) values.push(extra);
    }
    if (limit >= MIN_CONTEXT_TOKENS && !values.some((value) => near(value, limit))) values.push(limit);
    return [...new Set(values)].sort((a, b) => a - b);
  }

  function pickerContextOptions(maximum, count = PICKER_CONTEXT_CHOICES) {
    const limit = positiveInteger(maximum);
    if (!limit) return [];
    const size = Math.max(1, positiveInteger(count) || PICKER_CONTEXT_CHOICES);
    const preferred = PICKER_STANDARD_TOKENS.filter((value) => value <= limit);
    if (preferred.length) return preferred.slice(-size);
    return STANDARD_CONTEXT_TOKENS
      .filter((value) => value >= MIN_CONTEXT_TOKENS && value <= limit)
      .slice(-size);
  }

  return {
    FALLBACK_CONTEXT_TOKENS,
    MIN_CONTEXT_TOKENS,
    MAX_CONTEXT_TOKENS,
    STANDARD_CONTEXT_TOKENS,
    PICKER_STANDARD_TOKENS,
    PICKER_CONTEXT_CHOICES,
    REASONING_EFFORT_ORDER,
    contextKey,
    contextOptions,
    pickerContextOptions,
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
    formatContextWindowLabel,
    formatPickerContextLabel,
  };
});
