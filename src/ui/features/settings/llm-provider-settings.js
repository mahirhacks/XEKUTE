import {
  llmProvider, llmProviderOllama, llmProviderOpenRouter, llmOllamaConfig, llmOpenRouterConfig,
  llmOllamaEnableToggle, llmSettingsStatus, llmOpenRouterKeyToggle, llmOpenRouterKeyStatus,
  llmOpenRouterKeyFields, llmOpenRouterBaseToggle, llmOpenRouterBaseFields,
  llmOllamaEndpointToggle, llmOllamaEndpointStatus, llmOllamaEndpointFields, ollamaHostInput,
  modelsExploreSubagent, decisionModelSelect, modelsSettingsSearch, modelsSettingsList, modelsViewAllBtn,
  ollamaLocationBadge, ollamaActiveEndpoint, ollamaConnectionStatus, ollamaHostReset,
  statusOllamaPort, openRouterBaseUrl, openRouterModel, openRouterApiKey, commandSettingsStatus,
} from "../../core/dom-refs.js";
import { appState } from "../../core/app-state.js";
import {
  getExploreSubagentModel, modelsVisibleInPicker, isModelEnabled, setModelEnabled,
  syncSelectedModelFromEnabled, isCustomModelName, removeCustomModelName, modelsSettingsCatalog,
  enabledModelsFirst, refreshModelContextCapacity,
} from "../models/model-settings.js";
import {
  syncModelLabel, renderModelList, loadModels, modelDisplayName,
} from "../models/model-picker.js";

export const OLLAMA_PORT = 11435;
export const DEFAULT_DECISION_MODEL = "typesafe/jev-1.14";

async function loadDecisionModelOptions(savedValue = DEFAULT_DECISION_MODEL) {
  if (!decisionModelSelect) return;
  const selected = String(savedValue || DEFAULT_DECISION_MODEL).trim() || DEFAULT_DECISION_MODEL;
  decisionModelSelect.replaceChildren();
  const optionFor = (id, label = id) => {
    const option = document.createElement("option");
    option.value = String(id);
    option.textContent = String(label);
    return option;
  };
  decisionModelSelect.appendChild(optionFor(selected));
  let catalog;
  try {
    catalog = await window.api.openRouterDecisionModels?.();
  } catch {
    return;
  }
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  if (catalog?.error || !models.length) return;
  decisionModelSelect.replaceChildren();
  if (!models.some((model) => model?.id === selected)) decisionModelSelect.appendChild(optionFor(selected));
  for (const model of models) {
    if (!model?.id) continue;
    decisionModelSelect.appendChild(optionFor(model.id, model.name || model.id));
  }
  if (!decisionModelSelect.options.length) decisionModelSelect.appendChild(optionFor(DEFAULT_DECISION_MODEL));
  decisionModelSelect.value = selected;
}

export function syncLlmProviderUi(provider = "ollama") {
  const active = provider === "openrouter" ? "openrouter" : "ollama";
  if (llmProvider) llmProvider.value = active;
  if (llmProviderOllama) llmProviderOllama.checked = active === "ollama";
  if (llmProviderOpenRouter) llmProviderOpenRouter.checked = active === "openrouter";
  if (llmOllamaConfig) llmOllamaConfig.hidden = active !== "ollama";
  if (llmOpenRouterConfig) llmOpenRouterConfig.hidden = active !== "openrouter";
  if (llmOllamaEnableToggle) llmOllamaEnableToggle.checked = active === "ollama";
}

export const MODELS_SETTINGS_PAGE_SIZE = 10;

export function queueLlmSettingsAutosave(delay = 500) {
  clearTimeout(appState.llmAutosaveTimer);
  appState.llmAutosavePending = true;
  if (llmSettingsStatus) llmSettingsStatus.textContent = "Saving automatically…";
  appState.llmAutosaveTimer = setTimeout(() => { void flushLlmSettingsAutosave(); }, delay);
}

export async function flushLlmSettingsAutosave() {
  clearTimeout(appState.llmAutosaveTimer);
  appState.llmAutosaveTimer = null;
  if (appState.llmAutosaveRunning) return;
  appState.llmAutosaveRunning = true;
  appState.llmAutosavePending = false;
  try {
    await saveLlmSettings();
  } finally {
    appState.llmAutosaveRunning = false;
    if (appState.llmAutosavePending) queueLlmSettingsAutosave(0);
  }
}

export function syncOpenRouterApiFieldsUi() {
  const showKeyFields = Boolean(llmOpenRouterKeyToggle?.checked);
  if (llmOpenRouterKeyFields) llmOpenRouterKeyFields.hidden = !showKeyFields;
  if (llmOpenRouterKeyStatus) llmOpenRouterKeyStatus.hidden = !appState.llmOpenRouterHasSavedKey || showKeyFields;
  const showBaseFields = Boolean(llmOpenRouterBaseToggle?.checked);
  if (llmOpenRouterBaseFields) llmOpenRouterBaseFields.hidden = !showBaseFields;
}

export function syncOllamaApiFieldsUi() {
  const envLocked = Boolean(appState.ollamaSettingsData?.usingEnvironment);
  const hasCustomEndpoint = Boolean(appState.ollamaSettingsData?.host);
  const showEndpointFields = Boolean(llmOllamaEndpointToggle?.checked) && !envLocked;
  if (llmOllamaEndpointFields) llmOllamaEndpointFields.hidden = !showEndpointFields;
  if (llmOllamaEndpointStatus) {
    llmOllamaEndpointStatus.hidden = !hasCustomEndpoint || showEndpointFields || envLocked;
  }
  if (llmOllamaEndpointToggle) llmOllamaEndpointToggle.disabled = envLocked;
  if (ollamaHostInput) ollamaHostInput.disabled = envLocked;
}

export function renderExploreSubagentSelect() {
  if (!modelsExploreSubagent) return;
  const catalog = modelsVisibleInPicker();
  const current = getExploreSubagentModel();
  modelsExploreSubagent.innerHTML = "";
  if (!catalog.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Enable a model in Models";
    modelsExploreSubagent.appendChild(option);
    modelsExploreSubagent.disabled = true;
    return;
  }
  modelsExploreSubagent.disabled = false;
  for (const name of catalog) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    modelsExploreSubagent.appendChild(option);
  }
  if (current && catalog.includes(current)) modelsExploreSubagent.value = current;
}

export function renderModelsSettingsList() {
  if (!modelsSettingsList) return;
  const query = modelsSettingsSearch?.value.trim().toLowerCase() || "";
  const catalog = enabledModelsFirst(modelsSettingsCatalog());
  const filtered = catalog.filter((name) => !query || name.toLowerCase().includes(query));
  const visible = filtered.slice(0, appState.modelsSettingsDisplayLimit);

  modelsSettingsList.innerHTML = "";
  if (!visible.length) {
    modelsSettingsList.innerHTML = `<div class="models-settings-empty">${query ? "No models match your search" : "No models loaded. Refresh or add a model ID above."}</div>`;
    if (modelsViewAllBtn) modelsViewAllBtn.hidden = true;
    return;
  }

  for (const name of visible) {
    const row = document.createElement("div");
    row.className = "models-settings-row";
    row.dataset.model = name;

    const nameEl = document.createElement("span");
    nameEl.className = "models-settings-name";
    nameEl.textContent = name;
    nameEl.title = name;

    const actions = document.createElement("div");
    actions.className = "models-settings-row-actions";

    if (isCustomModelName(name)) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "models-delete-btn";
      deleteBtn.title = "Remove custom model";
      deleteBtn.setAttribute("aria-label", `Remove ${name}`);
      deleteBtn.innerHTML = '<span class="codicon codicon-trash"></span>';
      deleteBtn.addEventListener("click", () => {
        removeCustomModelName(name);
        renderModelsSettingsList();
        renderExploreSubagentSelect();
        renderModelList();
      });
      actions.appendChild(deleteBtn);
    }

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "general-toggle";
    toggleLabel.setAttribute("aria-label", `Enable ${name}`);
    const toggleInput = document.createElement("input");
    toggleInput.type = "checkbox";
    toggleInput.className = "ui-toggle";
    toggleInput.setAttribute("aria-label", `Enable ${name}`);
    toggleInput.checked = isModelEnabled(name);
    toggleInput.addEventListener("change", () => {
      setModelEnabled(name, toggleInput.checked);
      renderModelsSettingsList();
      renderExploreSubagentSelect();
      renderModelList();
      if (!toggleInput.checked && appState.selectedModel === name) {
        syncSelectedModelFromEnabled();
        syncModelLabel();
      }
    });
    toggleLabel.appendChild(toggleInput);
    actions.appendChild(toggleLabel);

    row.appendChild(nameEl);
    row.appendChild(actions);
    modelsSettingsList.appendChild(row);
  }

  if (modelsViewAllBtn) {
    modelsViewAllBtn.hidden = filtered.length <= appState.modelsSettingsDisplayLimit;
    modelsViewAllBtn.textContent = "View more";
  }
}

export async function refreshModelsSettingsPanel() {
  appState.modelsSettingsDisplayLimit = MODELS_SETTINGS_PAGE_SIZE;
  await loadModels({ showLoading: false });
  renderExploreSubagentSelect();
  renderModelsSettingsList();
}

export function initModelsSettingsPanel() {
  appState.modelsSettingsDisplayLimit = MODELS_SETTINGS_PAGE_SIZE;
  refreshModelsSettingsPanel();
}

export function selectedLlmProvider() {
  if (llmProviderOpenRouter?.checked) return "openrouter";
  if (llmProvider?.value === "openrouter") return "openrouter";
  return appState.activeLlmProvider === "openrouter" ? "openrouter" : "ollama";
}

export function isOpenRouterProvider() {
  return selectedLlmProvider() === "openrouter";
}

export function renderOllamaSettings(snapshot = appState.ollamaSettingsData) {
  if (!snapshot) return;
  appState.ollamaSettingsData = snapshot;
  if (ollamaHostInput) ollamaHostInput.value = snapshot.host || "";
  if (llmOllamaEndpointToggle) {
    llmOllamaEndpointToggle.checked = Boolean(snapshot.host) && !snapshot.usingEnvironment;
  }
  if (ollamaLocationBadge) {
    ollamaLocationBadge.textContent = snapshot.usingEnvironment ? "Environment" : snapshot.usingDefault ? "Default" : "Remote";
  }
  if (ollamaActiveEndpoint) ollamaActiveEndpoint.textContent = snapshot.activeBaseUrl || "";
  if (statusOllamaPort && snapshot.activeHost && selectedLlmProvider() === "ollama") {
    statusOllamaPort.textContent = `Ollama :${snapshot.activeHost}`;
  }
  if (ollamaHostReset) ollamaHostReset.disabled = Boolean(snapshot.usingDefault && !snapshot.host);
  if (ollamaConnectionStatus && !ollamaConnectionStatus.dataset.testing) {
    if (snapshot.usingEnvironment) ollamaConnectionStatus.textContent = "Controlled by OLLAMA_HOST environment variable";
    else if (snapshot.usingDefault) ollamaConnectionStatus.textContent = "Using local default endpoint";
    else ollamaConnectionStatus.textContent = "Saved remote endpoint";
  }
  syncOllamaApiFieldsUi();
}

export async function loadLlmSettings() {
  const result = await window.api.llmSettings?.();
  if (result?.error) {
    if (llmSettingsStatus) llmSettingsStatus.textContent = result.error;
    return;
  }
  syncLlmProviderUi(result.provider || "ollama");
  appState.activeLlmProvider = result.provider || "ollama";
  appState.llmOpenRouterHasSavedKey = Boolean(result.hasApiKey);
  const defaultBaseUrl = result.openrouter?.baseUrl || "https://openrouter.ai/api/v1";
  if (openRouterBaseUrl) openRouterBaseUrl.value = defaultBaseUrl;
  if (openRouterModel) openRouterModel.value = result.openrouter?.model || "";
  void loadDecisionModelOptions(result.decisionModel || DEFAULT_DECISION_MODEL);
  if (openRouterApiKey) openRouterApiKey.value = "";
  if (llmOpenRouterKeyToggle) llmOpenRouterKeyToggle.checked = false;
  if (llmOpenRouterBaseToggle) {
    llmOpenRouterBaseToggle.checked = defaultBaseUrl !== "https://openrouter.ai/api/v1";
  }
  syncOpenRouterApiFieldsUi();
  if (statusOllamaPort) {
    if (result.provider === "openrouter") {
      statusOllamaPort.textContent = result.openrouter?.model
        ? `OpenRouter · ${modelDisplayName(result.openrouter.model)}`
        : "OpenRouter";
    } else if (result.ollama?.activeBaseUrl) {
      try {
        const url = new URL(result.ollama.activeBaseUrl);
        statusOllamaPort.textContent = `Ollama :${url.port || (url.protocol === "https:" ? "443" : "80")}`;
      } catch {
        statusOllamaPort.textContent = "Ollama";
      }
    }
  }
  if (llmSettingsStatus) {
    if (result.provider === "openrouter") {
      llmSettingsStatus.textContent = result.hasApiKey
        ? "OpenRouter active · encrypted API key configured"
        : "OpenRouter active · API key required";
    } else {
      llmSettingsStatus.textContent = "Ollama active";
    }
  }
  if (window.api.ollamaSettings) {
    const ollama = await window.api.ollamaSettings();
    if (!ollama?.error) renderOllamaSettings(ollama);
  }
  void refreshModelContextCapacity();
}

export async function saveLlmSettings() {
  const provider = selectedLlmProvider();
  syncLlmProviderUi(provider);
  if (llmSettingsStatus) llmSettingsStatus.textContent = "Saving…";
  const ollamaHostPayload = llmOllamaEndpointToggle?.checked && !appState.ollamaSettingsData?.usingEnvironment
    ? (ollamaHostInput?.value?.trim() || "")
    : "";
  const ollamaResult = await window.api.setOllamaHost?.({ host: ollamaHostPayload });
  if (ollamaResult?.error) {
    if (llmSettingsStatus) llmSettingsStatus.textContent = ollamaResult.error;
    if (commandSettingsStatus) commandSettingsStatus.textContent = ollamaResult.error;
    return;
  }
  if (ollamaResult) renderOllamaSettings(ollamaResult);
  const openRouterModelId = provider === "openrouter"
    ? (appState.selectedModel || openRouterModel?.value || "")
    : openRouterModel?.value;
  const result = await window.api.setLlmSettings?.({
    provider,
    baseUrl: llmOpenRouterBaseToggle?.checked ? openRouterBaseUrl?.value : "https://openrouter.ai/api/v1",
    model: openRouterModelId,
    decisionModel: decisionModelSelect?.value || DEFAULT_DECISION_MODEL,
    ...(openRouterApiKey?.value ? { apiKey: openRouterApiKey.value } : {}),
  });
  if (result?.error) {
    if (llmSettingsStatus) llmSettingsStatus.textContent = result.error;
    if (commandSettingsStatus) commandSettingsStatus.textContent = result.error;
    return;
  }
  if (openRouterApiKey) openRouterApiKey.value = "";
  if (decisionModelSelect) decisionModelSelect.value = result.decisionModel || DEFAULT_DECISION_MODEL;
  appState.llmOpenRouterHasSavedKey = Boolean(result.hasApiKey);
  appState.activeLlmProvider = result.provider || provider;
  syncLlmProviderUi(result.provider || provider);
  if (llmOpenRouterKeyToggle) llmOpenRouterKeyToggle.checked = false;
  syncOpenRouterApiFieldsUi();
  if (result.provider === "openrouter" && result.openrouter?.model) {
    appState.selectedModel = result.openrouter.model;
    localStorage.setItem("pointer:model", appState.selectedModel);
  }
  if (llmSettingsStatus) {
    llmSettingsStatus.textContent = result.provider === "openrouter"
      ? (result.hasApiKey ? "Saved · OpenRouter active" : "Saved · OpenRouter active, but API key still required")
      : "Saved · Ollama active";
  }
  if (commandSettingsStatus) commandSettingsStatus.textContent = `Active provider: ${result.provider}`;
  await loadModels({ showLoading: true });
}

export async function testLlmSettings() {
  if (appState.llmAutosaveTimer || appState.llmAutosavePending) await flushLlmSettingsAutosave();
  if (llmSettingsStatus) llmSettingsStatus.textContent = "Testing active provider…";
  const result = await window.api.testLlmConnection?.();
  if (result?.error) {
    if (llmSettingsStatus) llmSettingsStatus.textContent = result.error;
    return;
  }
  const count = Number(result?.modelCount);
  if (llmSettingsStatus) {
    llmSettingsStatus.textContent = Number.isFinite(count)
      ? `Connected · ${result.provider || "provider"} · ${count} model${count === 1 ? "" : "s"}`
      : `Connected · ${result.provider || "provider"}`;
  }
}

export async function loadOllamaSettings() {
  if (!window.api.ollamaSettings) return;
  if (ollamaConnectionStatus) {
    ollamaConnectionStatus.dataset.testing = "";
    ollamaConnectionStatus.textContent = "Loading…";
  }
  const result = await window.api.ollamaSettings();
  if (result?.error) {
    if (ollamaConnectionStatus) ollamaConnectionStatus.textContent = result.error;
    return;
  }
  renderOllamaSettings(result);
}

export async function testOllamaSettings() {
  if (ollamaConnectionStatus) {
    ollamaConnectionStatus.dataset.testing = "1";
    ollamaConnectionStatus.textContent = "Testing connection…";
  }
  const result = await window.api.testOllamaConnection?.();
  delete ollamaConnectionStatus?.dataset.testing;
  if (result?.error) {
    if (ollamaConnectionStatus) ollamaConnectionStatus.textContent = result.error;
    return;
  }
  if (ollamaConnectionStatus) {
    ollamaConnectionStatus.textContent = result.modelCount
      ? `Connected · ${result.modelCount} model${result.modelCount === 1 ? "" : "s"} available`
      : "Connected · no models returned";
  }
}

export async function resetOllamaSettings() {
  if (ollamaConnectionStatus) ollamaConnectionStatus.textContent = "Resetting…";
  if (llmOllamaEndpointToggle) llmOllamaEndpointToggle.checked = false;
  if (ollamaHostInput) ollamaHostInput.value = "";
  const result = await window.api.setOllamaHost?.({ host: "" });
  if (result?.error) {
    if (ollamaConnectionStatus) ollamaConnectionStatus.textContent = result.error;
    return;
  }
  renderOllamaSettings(result);
  if (commandSettingsStatus) commandSettingsStatus.textContent = "Local Ollama default restored";
  await loadModels({ showLoading: true });
}
