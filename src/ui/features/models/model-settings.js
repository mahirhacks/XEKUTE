import {
  normalizeModelNames, syncModelLabel, selectedLlmProvider, syncModelControlsSummary,
  isOpenRouterProvider, renderReasoningOptions, renderContextOptions, updateModelRuntimeNote,
} from "../../bootstrap.js";
import { appState } from "../../core/app-state.js";
import { ContextBudget } from "../../core/runtime-globals.js";
import { refreshStoredContextCapacity, updateContextUsage } from "../chat/context-usage.js";

export const AUTO_CONTEXT = "Auto";
export const AUTO_CONTEXT_ESTIMATE = 4096;
export const LEGACY_DEFAULT_CONTEXT = "8K";

export const CONTEXT_OPTIONS = [AUTO_CONTEXT, "128K", "256K", "1M"];
export const MODEL_SETTINGS_KEY = "pointer:modelSettings";
export const ENABLED_MODELS_KEY = "pointer:enabledModels";
export const CUSTOM_MODELS_KEY = "pointer:customModels";
export const EXPLORE_SUBAGENT_MODEL_KEY = "pointer:exploreSubagentModel";

export const openRouterContextLengthsCache = new Map();
export const ollamaRuntimeContext = {};

export function loadCustomModels() {
  try {
    const raw = localStorage.getItem(CUSTOM_MODELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    localStorage.removeItem(CUSTOM_MODELS_KEY);
    return [];
  }
}

export function saveCustomModels(models) {
  localStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(normalizeModelNames(models)));
}

export function loadEnabledModels() {
  try {
    const raw = localStorage.getItem(ENABLED_MODELS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter(Boolean).map(String));
  } catch {
    localStorage.removeItem(ENABLED_MODELS_KEY);
    return null;
  }
}

export function saveEnabledModels(enabledSet) {
  if (!enabledSet || enabledSet.size === 0) {
    localStorage.removeItem(ENABLED_MODELS_KEY);
    return;
  }
  localStorage.setItem(ENABLED_MODELS_KEY, JSON.stringify([...enabledSet].sort()));
}

export function isModelEnabled(name) {
  const enabled = loadEnabledModels();
  if (!enabled) return false;
  return enabled.has(name);
}

export function setModelEnabled(name, enabled) {
  let enabledSet = loadEnabledModels() || new Set();
  if (enabled) enabledSet.add(name);
  else enabledSet.delete(name);
  saveEnabledModels(enabledSet);
}

export function syncSelectedModelFromEnabled() {
  if (appState.selectedModel && isModelEnabled(appState.selectedModel)) return;
  const next = modelsVisibleInPicker()[0] || "";
  appState.selectedModel = next;
  if (appState.selectedModel) localStorage.setItem("pointer:model", appState.selectedModel);
  else localStorage.removeItem("pointer:model");
  void refreshModelContextCapacity();
}

export function isCustomModelName(name) {
  return loadCustomModels().includes(name);
}

export function addCustomModelName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  const custom = loadCustomModels();
  if (!custom.includes(trimmed)) {
    saveCustomModels([...custom, trimmed]);
  }
  if (!appState.allModels.includes(trimmed)) {
    appState.allModels = normalizeModelNames([trimmed, ...appState.allModels]);
  }
  return trimmed;
}

export function removeCustomModelName(name) {
  const custom = loadCustomModels().filter((entry) => entry !== name);
  saveCustomModels(custom);
  const enabled = loadEnabledModels();
  if (enabled) {
    enabled.delete(name);
    saveEnabledModels(enabled);
  }
  appState.allModels = normalizeModelNames(appState.allModels.filter((entry) => entry !== name));
  if (appState.selectedModel === name) {
    syncSelectedModelFromEnabled();
    syncModelLabel();
  }
}

export function getExploreSubagentModel() {
  const stored = localStorage.getItem(EXPLORE_SUBAGENT_MODEL_KEY);
  const enabledPicker = modelsVisibleInPicker();
  if (stored && enabledPicker.includes(stored)) return stored;
  if (appState.selectedModel && isModelEnabled(appState.selectedModel)) return appState.selectedModel;
  return enabledPicker[0] || "";
}

export function modelsSettingsCatalog() {
  return normalizeModelNames([...loadCustomModels(), ...appState.allModels]);
}

export function enabledModelsFirst(models, enabled = loadEnabledModels()) {
  const catalog = Array.isArray(models) ? [...models] : [];
  if (!enabled || enabled.size === 0) return catalog;
  return [
    ...catalog.filter((name) => enabled.has(name)),
    ...catalog.filter((name) => !enabled.has(name)),
  ];
}

export function modelsVisibleInPicker() {
  const enabled = loadEnabledModels();
  if (!enabled || enabled.size === 0) return [];
  return modelsSettingsCatalog().filter((name) => enabled.has(name));
}

export function loadModelSettings() {
  try {
    const raw = localStorage.getItem(MODEL_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const normalized = {};
    for (const [name, settings] of Object.entries(parsed)) {
      if (!settings || typeof settings !== "object") continue;
      const rawContext = typeof settings.context === "string"
        ? settings.context
        : (ContextBudget?.positiveInteger(settings.context) ? String(settings.context) : AUTO_CONTEXT);
      const rawContextTokens = ContextBudget?.positiveInteger(settings.contextLimitTokens || ContextBudget.legacyContextLabelToTokens(rawContext));
      const explicitManualContext =
        settings.contextLocked === true
        || (rawContext !== AUTO_CONTEXT && rawContext !== LEGACY_DEFAULT_CONTEXT);
      // Older XEKUTE builds persisted `thinking: false` for every model even
      // when the user never disabled it. Treat that legacy value as "auto" so
      // Ollama can use its capability-aware default. A true value could only
      // have been chosen explicitly in the old UI, so preserve it.
      const thinkingConfigured = settings.thinkingConfigured === true || settings.thinking === true;
      const rawReasoningEffort = String(settings.reasoningEffort || "").trim().toLowerCase();
      const limitTokens = ContextBudget?.positiveInteger(settings.contextLimitTokens || ContextBudget.legacyContextLabelToTokens(rawContext));
      normalized[name] = {
        thinking: thinkingConfigured ? Boolean(settings.thinking) : null,
        thinkingConfigured,
        reasoningEffort: rawReasoningEffort === "auto"
          ? "auto"
          : (ContextBudget?.normalizeReasoningEffort(rawReasoningEffort) || null),
        context: explicitManualContext && rawContextTokens
          ? (CONTEXT_OPTIONS.includes(rawContext) ? rawContext : ContextBudget.tokensToContextLabel(rawContextTokens))
          : AUTO_CONTEXT,
        contextLocked: explicitManualContext,
        contextMode: explicitManualContext ? "custom" : "auto",
        contextLimitTokens: explicitManualContext ? (limitTokens || rawContextTokens) : null,
      };
    }
    return normalized;
  } catch {
    localStorage.removeItem(MODEL_SETTINGS_KEY);
    return {};
  }
}

export function getModelSettings(name) {
  const provider = String(selectedLlmProvider?.() || appState.activeLlmProvider || "ollama").toLowerCase();
  const key = ContextBudget?.contextKey(provider, name) || `${provider}:${name}`;
  const legacy = appState.modelSettings[name];
  if (!appState.modelSettings[key]) {
    appState.modelSettings[key] = legacy ? { ...legacy } : {
      thinking: null,
      thinkingConfigured: false,
      reasoningEffort: null,
      context: AUTO_CONTEXT,
      contextLocked: false,
      contextMode: "auto",
      contextLimitTokens: null,
    };
  }
  return appState.modelSettings[key];
}

export function modelThinkingEnabled(settings) {
  // null means automatic: omit the API option and let Ollama enable thinking
  // only for models that advertise the capability.
  return settings?.thinking !== false;
}

export function saveModelSettings() {
  localStorage.setItem(MODEL_SETTINGS_KEY, JSON.stringify(appState.modelSettings));
}

export function setModelSetting(name, key, value) {
  getModelSettings(name)[key] = value;
  if (key === "context") {
    const tokens = value === AUTO_CONTEXT
      ? null
      : (ContextBudget?.positiveInteger(value) || ContextBudget?.legacyContextLabelToTokens(value) || null);
    getModelSettings(name).context = tokens ? String(tokens) : AUTO_CONTEXT;
    getModelSettings(name).contextLocked = Boolean(tokens);
    getModelSettings(name).contextMode = tokens ? "custom" : "auto";
    getModelSettings(name).contextLimitTokens = tokens;
  }
  saveModelSettings();
  if (name === appState.selectedModel) syncModelControlsSummary();
  if (name === appState.selectedModel && key === "context") {
    updateContextUsage();
    void refreshStoredContextCapacity();
  }
}

export function contextLabelToTokens(label) {
  return ContextBudget?.legacyContextLabelToTokens(label) || null;
}

export function tokensToContextLabel(tokens) {
  return ContextBudget?.tokensToContextLabel(tokens) || AUTO_CONTEXT;
}

export async function fetchOpenRouterModelMetadata(modelName) {
  if (!modelName || !isOpenRouterProvider()) return ContextBudget.normalizeModelMetadata({}, modelName);
  const existing = appState.openRouterModelMeta[modelName];
  if ((existing?.contextWindowTokens || existing?.contextLength) && openRouterContextLengthsCache.has(modelName)) {
    return ContextBudget.normalizeModelMetadata(existing, modelName);
  }
  if (window.api?.openRouterModelContexts) {
    try {
      const result = await window.api.openRouterModelContexts({ model: modelName });
      const endpointMaximum = Array.isArray(result?.contextLengths) && result.contextLengths.length
        ? Math.max(...result.contextLengths.map(Number).filter((value) => Number.isFinite(value) && value > 0))
        : null;
      if (result?.modelMeta || endpointMaximum) {
        appState.openRouterModelMeta[modelName] = {
          ...(appState.openRouterModelMeta[modelName] || {}),
          ...(result.modelMeta || {}),
          ...(endpointMaximum && !result.modelMeta?.contextWindowTokens ? { contextWindowTokens: endpointMaximum, contextLength: endpointMaximum, source: "endpoint" } : {}),
          endpointContextLengths: Array.isArray(result?.endpointContextLengths) ? result.endpointContextLengths : [],
        };
      }
      openRouterContextLengthsCache.set(modelName, Array.isArray(result?.contextLengths) ? result.contextLengths : []);
      const metadata = ContextBudget.normalizeModelMetadata(appState.openRouterModelMeta[modelName] || {}, modelName);
      if (metadata.contextWindowTokens || metadata.maxCompletionTokens) return metadata;
    } catch {
      /* Fall back to the model list metadata. */
    }
  }
  return ContextBudget.normalizeModelMetadata(appState.openRouterModelMeta[modelName] || {}, modelName);
}

export async function ensureOpenRouterModelContext(modelName) {
  return fetchOpenRouterModelMetadata(modelName);
}

export function contextPreferenceFor(modelName) {
  const settings = getModelSettings(modelName);
  return {
    mode: settings.contextMode || (settings.contextLocked ? "custom" : "auto"),
    limitTokens: settings.contextLimitTokens || contextLabelToTokens(settings.context),
  };
}

export function resolveModelContextPlan(modelName, metadata = {}, runtime = null) {
  return ContextBudget.resolveContextPlan({
    provider: isOpenRouterProvider() ? "openrouter" : "ollama",
    model: modelName,
    metadata,
    preference: contextPreferenceFor(modelName),
    runtime,
  });
}

export async function refreshModelContextCapacity() {
  if (!appState.selectedModel) {
    appState.resolvedContextCapacity = { tokens: AUTO_CONTEXT_ESTIMATE, source: "fallback", approximate: true };
    updateContextUsage();
    return;
  }

  const seq = ++appState.contextCapacitySeq;

  if (isOpenRouterProvider()) {
    const metadata = await ensureOpenRouterModelContext(appState.selectedModel);
    if (seq !== appState.contextCapacitySeq) return;
    const plan = resolveModelContextPlan(appState.selectedModel, metadata);
    appState.resolvedContextCapacity = {
      tokens: plan.effectiveLimitTokens,
      source: plan.source,
      approximate: plan.approximate,
      plan,
    };
    updateContextUsage();
    return;
  }

  try {
    const runtime = await window.api.runtimeModel({ model: appState.selectedModel });
    if (seq !== appState.contextCapacitySeq) return;
    if (runtime?.ok && runtime.contextLength) ollamaRuntimeContext[appState.selectedModel] = runtime.contextLength;
    const plan = resolveModelContextPlan(appState.selectedModel, {}, runtime?.ok ? runtime : null);
    appState.resolvedContextCapacity = { tokens: plan.effectiveLimitTokens, source: plan.source, approximate: plan.approximate, plan };
    updateContextUsage();
  } catch {
    if (seq !== appState.contextCapacitySeq) return;
    const plan = resolveModelContextPlan(appState.selectedModel);
    appState.resolvedContextCapacity = { tokens: plan.effectiveLimitTokens, source: plan.source, approximate: plan.approximate, plan };
    updateContextUsage();
  }
}

export async function applyOpenRouterModelDefaults(modelName) {
  const metadata = await ensureOpenRouterModelContext(modelName);
  if (modelName === appState.selectedModel) await refreshModelContextCapacity();
  if (appState.editingModel === modelName) {
    renderReasoningOptions(metadata);
    renderContextOptions(getModelSettings(modelName).context, metadata);
    updateModelRuntimeNote(modelName);
  }
  syncModelControlsSummary();
  return metadata;
}
