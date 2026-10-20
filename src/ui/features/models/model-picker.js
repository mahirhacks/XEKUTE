import { appState } from "../../core/app-state.js";
import {
  modelPicker, modelLabel, modelControlsMenu, modelContextTrigger, modelEffortTrigger,
  modelBrowseTrigger, modelContextValue, modelEffortValue, modelCurrentName, modelMenu,
  modelEditMenu, modelSearch, modelAddForm, thinkingToggle, ollamaThinkingSection,
  reasoningOptions, contextOptions, ollamaThinkingRow, openRouterReasoningRow, modelList,
  openRouterModel, statusOllamaPort, modelCustom,
} from "../../core/dom-refs.js";
import { updateContextUsage, closeContextPopover } from "../chat/context-usage.js";
import {
  AUTO_CONTEXT, ollamaRuntimeContext, getModelSettings, modelThinkingEnabled,
  contextLabelToTokens, refreshModelContextCapacity, ensureOpenRouterModelContext,
  saveModelSettings, setModelSetting, AUTO_CONTEXT_ESTIMATE, fetchOpenRouterModelMetadata,
  resolveModelContextPlan, openRouterContextLengthsCache, syncSelectedModelFromEnabled,
  addCustomModelName, modelsVisibleInPicker, applyOpenRouterModelDefaults,
} from "./model-settings.js";
import {
  isOpenRouterProvider, closeAuthorityMenu, renderExploreSubagentSelect, renderModelsSettingsList,
} from "../../bootstrap.js";
import { closeChatModeMenu } from "../chat/chat-mode.js";
import { ContextBudget } from "../../core/runtime-globals.js";
import { formatContextWindowLabel, formatTokenCount, escapeHtml } from "../../core/text-format.js";

export function modelDisplayName(name = "") {
  return name.slice(name.lastIndexOf("/") + 1);
}

export function syncModelLabel() {
  if (!modelLabel) return;
  modelLabel.textContent = modelDisplayName(appState.selectedModel) || "Select model";
  if (modelPicker) {
    modelPicker.title = appState.selectedModel ? `Model: ${appState.selectedModel}` : "Select model";
  }
  updateContextUsage();
  syncModelControlsSummary();
}

export function syncModelControlsSummary() {
  if (!modelControlsMenu) return;
  const settings = getModelSettings(appState.selectedModel);
  const metadata = appState.openRouterModelMeta[appState.selectedModel] || {};
  const maximum = isOpenRouterProvider()
    ? Math.max(Number(metadata.contextWindowTokens) || 0, ...(metadata.endpointContextLengths || []))
    : Number(ollamaRuntimeContext[appState.selectedModel]) || 0;
  const configured = settings.contextMode === "custom" ? Number(settings.contextLimitTokens) || contextLabelToTokens(settings.context) : null;
  const resolved = appState.resolvedContextCapacity?.plan?.model === appState.selectedModel ? appState.resolvedContextCapacity.tokens : null;
  const tokens = configured ? (maximum ? Math.min(configured, maximum) : configured) : resolved || maximum;
  modelContextValue.textContent = tokens ? formatOpenRouterContextLabel(tokens) : AUTO_CONTEXT;
  modelContextTrigger.disabled = !appState.selectedModel;
  if (isOpenRouterProvider()) {
    const { reasoning, selected } = openRouterReasoningState(appState.selectedModel);
    modelEffortValue.textContent = selected ? reasoningEffortLabel(selected) : reasoning?.mandatory ? "Required" : reasoning?.available ? "Auto" : "Unavailable";
    modelEffortTrigger.disabled = !appState.selectedModel || !reasoning?.available;
  } else {
    modelEffortValue.textContent = settings.thinkingConfigured ? (modelThinkingEnabled(settings) ? "On" : "Off") : "Auto";
    modelEffortTrigger.disabled = !appState.selectedModel;
  }
  modelCurrentName.textContent = modelDisplayName(appState.selectedModel) || "Select model";
  modelBrowseTrigger.title = appState.selectedModel || "Select model";
}

export function openModelControlsMenu() {
  closeModelMenu();
  closeChatModeMenu();
  closeAuthorityMenu();
  syncModelControlsSummary();
  modelControlsMenu.hidden = false;
  modelPicker.classList.add("open");
  modelPicker.setAttribute("aria-haspopup", "menu");
  modelPicker.setAttribute("aria-expanded", "true");
  positionModelPanel(modelControlsMenu, modelPicker);
  modelControlsMenu.querySelector("button:not(:disabled)")?.focus();
  const modelName = appState.selectedModel;
  void refreshModelContextCapacity().then(() => {
    if (modelControlsMenu.hidden || appState.selectedModel !== modelName) return;
    syncModelControlsSummary();
    positionModelPanel(modelControlsMenu, modelPicker);
  });
}

export function positionModelPanel(menu, anchor, beside = false) {
  const rect = anchor.getBoundingClientRect();
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;
  const pad = 8;
  let left = rect.left;
  let top = rect.top - menuH - pad;
  if (beside) {
    const parent = modelControlsMenu.getBoundingClientRect();
    left = parent.right + 4;
    if (left + menuW > window.innerWidth - pad) left = parent.left - menuW - 4;
    top = rect.top;
  } else if (top < pad) top = rect.bottom + pad;
  menu.style.left = `${Math.max(pad, Math.min(left, window.innerWidth - menuW - pad))}px`;
  menu.style.top = `${Math.max(pad, Math.min(top, window.innerHeight - menuH - pad))}px`;
}

export function positionModelMenu() {
  modelMenu.classList.toggle("is-openrouter", isOpenRouterProvider());
  modelMenu.style.width = `${isOpenRouterProvider() ? 230 : 340}px`;
  positionModelPanel(modelMenu, modelBrowseTrigger, true);
}

export function closeModelEditMenu() {
  appState.modelEditRequest++;
  modelEditMenu.hidden = true;
  appState.editingModel = null;
  modelContextTrigger.setAttribute("aria-expanded", "false");
  modelEffortTrigger.setAttribute("aria-expanded", "false");
}

export function closeModelMenu() {
  modelControlsMenu.hidden = true;
  modelMenu.hidden = true;
  modelBrowseTrigger.setAttribute("aria-expanded", "false");
  modelPicker.setAttribute("aria-expanded", "false");
  modelMenu.style.visibility = "";
  modelPicker.classList.remove("open");
  modelAddForm.hidden = true;
  modelSearch.value = "";
  closeModelEditMenu();
  closeContextPopover();
  renderModelList();
}

export function positionModelEditMenu(anchorEl) {
  if (!anchorEl) return;
  positionModelPanel(modelEditMenu, anchorEl, true);
}

export async function openModelEditMenu(panel, anchor) {
  if (!appState.selectedModel) return;
  if (!modelEditMenu.hidden && modelEditMenu.dataset.panel === panel) {
    closeModelEditMenu();
    return;
  }
  closeModelEditMenu();
  modelMenu.hidden = true;
  modelBrowseTrigger.setAttribute("aria-expanded", "false");
  const modelName = appState.selectedModel;
  const request = ++appState.modelEditRequest;
  appState.editingModel = modelName;
  modelEditMenu.dataset.panel = panel;
  modelEditMenu.hidden = false;
  anchor.setAttribute("aria-expanded", "true");
  const settings = getModelSettings(modelName);
  renderReasoningOptions(isOpenRouterProvider() ? (appState.openRouterModelMeta[modelName] || null) : null);
  const thinkingEnabled = modelThinkingEnabled(settings);
  thinkingToggle.classList.toggle("on", thinkingEnabled);
  thinkingToggle.setAttribute("aria-pressed", String(thinkingEnabled));
  thinkingToggle.title = settings.thinkingConfigured
    ? (thinkingEnabled ? "Thinking enabled" : "Thinking disabled")
    : "Thinking automatic for supported models";
  if (isOpenRouterProvider()) {
    renderContextOptions(settings.context, appState.openRouterModelMeta[modelName] || null);
    positionModelEditMenu(anchor);
    const metadata = await ensureOpenRouterModelContext(modelName);
    if (request !== appState.modelEditRequest || appState.selectedModel !== modelName || modelEditMenu.hidden) return;
    renderReasoningOptions(metadata);
    renderContextOptions(getModelSettings(modelName).context, metadata);
  } else {
    renderReasoningOptions(null);
    renderContextOptions(settings.context, null);
    if (window.api?.runtimeModel) {
      void window.api.runtimeModel({ model: modelName }).then((result) => {
        if (request !== appState.modelEditRequest || appState.editingModel !== modelName || !result?.ok) return;
        if (result.contextLength) ollamaRuntimeContext[modelName] = result.contextLength;
        renderContextOptions(getModelSettings(modelName).context, {
          contextWindowTokens: result.contextLength,
        });
        syncModelControlsSummary();
        positionModelEditMenu(anchor);
      }).catch(() => {});
    }
  }
  syncModelControlsSummary();
  positionModelEditMenu(anchor);
  const section = panel === "context" ? contextOptions : isOpenRouterProvider() ? reasoningOptions : ollamaThinkingSection;
  (section.querySelector("button.selected") || section.querySelector("button"))?.focus();
}

export function reasoningEffortLabel(value) {
  if (value === "xhigh") return "XHigh";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export function openRouterReasoningState(modelName, openRouterMetadata = null) {
  const metadata = ContextBudget.normalizeModelMetadata(
    openRouterMetadata || appState.openRouterModelMeta[modelName] || {},
    modelName,
  );
  const reasoning = metadata.reasoning;
  const efforts = reasoning?.selectable
    ? reasoning.supportedEfforts.filter((effort) => !reasoning.mandatory || effort !== "none")
    : [];
  const configured = ContextBudget.normalizeReasoningEffort(getModelSettings(modelName).reasoningEffort);
  const selected = efforts.includes(configured)
    ? configured
    : efforts.includes(reasoning?.defaultEffort)
      ? reasoning.defaultEffort
      : efforts.includes("medium")
        ? "medium"
        : (efforts[0] || null);
  return { metadata, reasoning, efforts, selected };
}

export function renderModelPrimaryLabel(primary, modelName) {
  if (!primary) return;
  primary.textContent = modelDisplayName(modelName);
}

export function renderReasoningOptions(openRouterMetadata = null) {
  const openRouter = isOpenRouterProvider();
  if (ollamaThinkingSection) ollamaThinkingSection.hidden = openRouter;
  if (ollamaThinkingRow) ollamaThinkingRow.hidden = openRouter;
  if (openRouterReasoningRow) openRouterReasoningRow.hidden = !openRouter;
  if (!reasoningOptions) return;
  reasoningOptions.innerHTML = "";
  if (!openRouter || !appState.editingModel) {
    if (openRouterReasoningRow) openRouterReasoningRow.hidden = true;
    return;
  }

  const { metadata, reasoning, efforts: effortOptions, selected } = openRouterReasoningState(
    appState.editingModel,
    openRouterMetadata,
  );
  if (!reasoning?.available) {
    if (openRouterReasoningRow) openRouterReasoningRow.hidden = true;
    return;
  }

  if (!reasoning.selectable || !effortOptions.length) {
    const note = document.createElement("span");
    note.className = "reasoning-unavailable";
    note.textContent = reasoning.mandatory ? "Required" : "Automatic";
    note.title = reasoning.mandatory
      ? "This model requires reasoning."
      : "This model exposes reasoning but no selectable effort levels.";
    reasoningOptions.appendChild(note);
    return;
  }

  const settings = getModelSettings(appState.editingModel);
  if (selected && settings.reasoningEffort !== selected) {
    settings.reasoningEffort = selected;
    saveModelSettings();
  }

  for (const effort of effortOptions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reasoning-option" + (effort === selected ? " selected" : "");
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(effort === selected));
    const label = document.createElement("span");
    label.textContent = reasoningEffortLabel(effort, metadata);
    const check = document.createElement("span");
    check.className = "codicon codicon-check";
    check.setAttribute("aria-hidden", "true");
    button.append(label, check);
    button.title = `Use ${effort} reasoning effort`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!appState.editingModel) return;
      setModelSetting(appState.editingModel, "reasoningEffort", effort);
      renderReasoningOptions(metadata);
      syncModelControlsSummary();
      closeModelEditMenu();
      modelEffortTrigger.focus();
    });
    reasoningOptions.appendChild(button);
  }
}

export function formatOpenRouterContextLabel(tokens) {
  return ContextBudget?.positiveInteger(tokens)
    ? (ContextBudget.formatPickerContextLabel(tokens) || formatContextWindowLabel(tokens))
    : AUTO_CONTEXT;
}

export function nearestContextChoice(choices, tokens) {
  const selected = Number(tokens);
  if (!Array.isArray(choices) || !choices.length) return null;
  if (!Number.isFinite(selected) || selected <= 0) return choices[0];
  return choices.reduce((best, value) => Math.abs(value - selected) < Math.abs(best - selected) ? value : best);
}

export function pickerContextMaximum(metadataHint = null) {
  if (isOpenRouterProvider()) {
    const metadata = ContextBudget.normalizeModelMetadata(
      metadataHint || appState.openRouterModelMeta[appState.editingModel] || {},
      appState.editingModel,
    );
    return Math.max(
      Number(metadata.contextWindowTokens) || 0,
      ...(Array.isArray(metadata.endpointContextLengths) ? metadata.endpointContextLengths : []),
    ) || null;
  }
  return ContextBudget.positiveInteger(metadataHint?.contextWindowTokens)
    || ContextBudget.positiveInteger(ollamaRuntimeContext[appState.editingModel])
    || (appState.resolvedContextCapacity?.plan?.model === appState.editingModel
      ? ContextBudget.positiveInteger(appState.resolvedContextCapacity.plan.modelMaxTokens)
      : null)
    || 1_048_576;
}

export function renderContextOptions(selected, metadataHint = null) {
  contextOptions.innerHTML = "";
  const settings = appState.editingModel ? getModelSettings(appState.editingModel) : { context: AUTO_CONTEXT, contextMode: "auto" };
  const maximum = pickerContextMaximum(metadataHint);
  if (isOpenRouterProvider() && !maximum) {
    const note = document.createElement("span");
    note.className = "model-edit-note";
    note.textContent = "Fetching model context…";
    contextOptions.appendChild(note);
    return;
  }
  const choices = ContextBudget.pickerContextOptions(maximum);
  const autoSelected = settings.contextMode !== "custom";
  const selectedTokens = autoSelected
    ? null
    : (settings.contextLimitTokens || ContextBudget.positiveInteger(selected) || contextLabelToTokens(selected) || null);
  const matched = nearestContextChoice(choices, selectedTokens);
  const matchedExactly = matched && selectedTokens
    && Math.abs(matched - selectedTokens) / Math.max(matched, selectedTokens) < 0.04;

  const autoBtn = document.createElement("button");
  autoBtn.type = "button";
  autoBtn.className = "context-option" + (autoSelected ? " selected" : "");
  autoBtn.innerHTML = `<span>${AUTO_CONTEXT}</span><span class="codicon codicon-check"></span>`;
  autoBtn.title = "Use the model's full advertised context window";
  autoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!appState.editingModel) return;
    setModelSetting(appState.editingModel, "context", AUTO_CONTEXT);
    renderContextOptions(AUTO_CONTEXT, metadataHint);
    closeModelEditMenu();
    modelContextTrigger.focus();
  });
  contextOptions.appendChild(autoBtn);

  for (const tokens of choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "context-option" + (!autoSelected && matchedExactly && tokens === matched ? " selected" : "");
    const pickerLabel = formatOpenRouterContextLabel(tokens);
    const windowLabel = formatContextWindowLabel(tokens);
    btn.innerHTML = `<span>${pickerLabel}</span><span class="codicon codicon-check"></span>`;
    btn.title = `Use a ${windowLabel} token context window`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!appState.editingModel) return;
      setModelSetting(appState.editingModel, "context", tokens);
      renderContextOptions(tokens, metadataHint);
      closeModelEditMenu();
      modelContextTrigger.focus();
    });
    contextOptions.appendChild(btn);
  }
}

export async function updateModelRuntimeNote(modelName) {
  const settings = getModelSettings(modelName);
  if (isOpenRouterProvider()) {
    const metadata = await fetchOpenRouterModelMetadata(modelName);
    const plan = resolveModelContextPlan(modelName, metadata);
    const maximum = metadata.contextWindowTokens
      ? `${formatContextWindowLabel(metadata.contextWindowTokens)} maximum`
      : "maximum unavailable";
    const endpointNote = metadata.endpointContextLengths?.length
      ? ` ${metadata.endpointContextLengths.length} provider endpoint${metadata.endpointContextLengths.length === 1 ? "" : "s"} reported.`
      : "";
    const output = metadata.maxCompletionTokens
      ? ` · ${formatContextWindowLabel(metadata.maxCompletionTokens)} output max`
      : "";
    const budget = plan.mode === "custom"
      ? `App budget ${formatContextWindowLabel(plan.effectiveLimitTokens)}.`
      : `Auto app budget ${formatContextWindowLabel(plan.effectiveLimitTokens)}.`;
    const openRouterNote = `OpenRouter ${maximum}${output}.${endpointNote} ${budget} ${plan.approximate ? "Capacity is approximate until model metadata is available." : ""}`;
    setModelRuntimeNote(openRouterNote.trim(), plan.approximate);
    return;
    /*
    const legacyNote = lengths.length
      ? `Official OpenRouter context windows: ${lengths.map((value) => formatTokenCount(value)).join(" · ")}`
      : "OpenRouter context metadata is unavailable for this model.";
    setModelRuntimeNote(legacyNote, false);
    return;
    */
  }
  const baseNote = settings.context === AUTO_CONTEXT
    ? "Auto lets Ollama choose a VRAM-aware context."
    : "Manual context overrides can increase VRAM use and trigger CPU offload.";
  setModelRuntimeNote(baseNote, false);

  if (!window.api?.runtimeModel || !modelName) return;

  try {
    const result = await window.api.runtimeModel({ model: modelName });
    if (appState.editingModel !== modelName || !result?.ok) return;
    if (!result.loaded) {
      setModelRuntimeNote(`Model not loaded yet. ${baseNote}`, false);
      return;
    }

    const parts = [];
    const contextLabel = result.contextLength ? `${formatTokenCount(result.contextLength)} ctx` : "active ctx";

    if (typeof result.gpuRatio === "number") {
      parts.push(`Loaded with ~${Math.round(result.gpuRatio * 100)}% in VRAM at ${contextLabel}.`);
    } else {
      parts.push(`Loaded at ${contextLabel}.`);
    }

    let warn = false;
    if (result.fullyGpu === false) {
      warn = true;
      parts.push("This model is partially offloaded to CPU, which caps GPU utilization.");
    }
    if (settings.context === AUTO_CONTEXT) {
      parts.push("Auto avoids forcing a larger context than Ollama can comfortably fit.");
    } else if (result.contextLength && result.contextLength > AUTO_CONTEXT_ESTIMATE) {
      warn = true;
      parts.push("Switching back to Auto or using a smaller model can reduce VRAM pressure.");
    }

    setModelRuntimeNote(parts.join(" "), warn);
  } catch {
    setModelRuntimeNote(baseNote, false);
  }
}

export function showModelListLoading() {
  modelList.innerHTML = `<div class="model-list-empty">Loading models…</div>`;
}

export function setModelListMessage(message) {
  if (!modelList) return;
  modelList.innerHTML = `<div class="model-list-empty">${escapeHtml(message)}</div>`;
}

export function normalizeModelNames(models) {
  return [...new Set((models || []).filter(Boolean).map(String))].sort();
}

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function applyOllamaListResult(result) {
  if (result?.provider) appState.activeLlmProvider = result.provider;
  if (result?.provider === "openrouter" && result?.modelMeta) {
    appState.openRouterModelMeta = result.modelMeta;
    openRouterContextLengthsCache.clear();
  }
  if (statusOllamaPort) {
    if (result?.provider === "openrouter") {
      statusOllamaPort.textContent = appState.selectedModel ? `OpenRouter · ${modelDisplayName(appState.selectedModel)}` : "OpenRouter";
    } else if (result?.host) {
      statusOllamaPort.textContent = `Ollama :${result.host}`;
    }
  }

  if (!result || result.error) {
    appState.allModels = normalizeModelNames(appState.selectedModel ? [appState.selectedModel] : []);
    if (appState.allModels.length) {
      renderModelList();
    } else if (modelList) {
      setModelListMessage(result?.error || "Failed to load models");
    }
    return;
  }

  appState.allModels = normalizeModelNames(result.models);
  const preferred = result.provider === "openrouter"
    ? (openRouterModel?.value || appState.selectedModel)
    : appState.selectedModel;
  if (preferred && !appState.allModels.includes(preferred)) {
    addCustomModelName(preferred);
  }
  syncSelectedModelFromEnabled();
  if (result.provider === "openrouter" && statusOllamaPort) {
    statusOllamaPort.textContent = appState.selectedModel ? `OpenRouter · ${modelDisplayName(appState.selectedModel)}` : "OpenRouter";
  }
  renderModelList();
  renderExploreSubagentSelect();
  if (appState.appSettingsSection === "llm") {
    renderModelsSettingsList();
  }
  if (result?.provider === "openrouter" && appState.selectedModel) {
    void ensureOpenRouterModelContext(appState.selectedModel).then(() => refreshModelContextCapacity());
  } else {
    void refreshModelContextCapacity();
  }
}

export async function loadModels({ showLoading = true } = {}) {
  const seq = ++appState.modelLoadSeq;
  syncModelLabel();
  if (showLoading) showModelListLoading();

  if (!window.api?.listModels) {
    appState.allModels = normalizeModelNames(appState.selectedModel ? [appState.selectedModel] : []);
    if (appState.allModels.length) renderModelList();
    else setModelListMessage("App bridge not ready. Restart the app.");
    return;
  }

  try {
    if (!appState.modelLoadInFlight) {
      appState.modelLoadInFlight = withTimeout(
        window.api.listModels(),
        9000,
        "Ollama model loading timed out.",
      ).finally(() => {
        appState.modelLoadInFlight = null;
      });
    }
    const result = await appState.modelLoadInFlight;
    if (seq !== appState.modelLoadSeq) return;
    applyOllamaListResult(result);
  } catch (err) {
    if (seq !== appState.modelLoadSeq) return;
    appState.allModels = normalizeModelNames(appState.selectedModel ? [appState.selectedModel] : []);
    if (appState.allModels.length) renderModelList();
    else setModelListMessage(err.message || "Failed to load models");
  } finally {
    if (seq !== appState.modelLoadSeq) return;
    syncModelLabel();
    if (!modelMenu.hidden) positionModelMenu();
  }
}

export function renderModelList() {
  modelMenu?.classList.toggle("is-openrouter", isOpenRouterProvider());
  const query = modelSearch.value.trim().toLowerCase();
  const pickerModels = modelsVisibleInPicker();
  const filtered = pickerModels.filter((m) => m.toLowerCase().includes(query));

  modelList.innerHTML = "";
  if (!filtered.length) {
    modelList.innerHTML = `<div class="model-list-empty">${query ? "No models match your search" : "No models found"}</div>`;
    return;
  }

  for (const name of filtered) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "model-item" + (name === appState.selectedModel ? " selected" : "");
    row.dataset.model = name;

    const nameEl = document.createElement("span");
    nameEl.className = "model-item-name";
    nameEl.title = name;
    const slashIndex = name.lastIndexOf("/");
    const primary = document.createElement("span");
    primary.className = "model-item-primary";
    renderModelPrimaryLabel(primary, name);
    nameEl.appendChild(primary);
    if (slashIndex >= 0) {
      const secondary = document.createElement("span");
      secondary.className = "model-item-secondary";
      secondary.textContent = name.slice(0, slashIndex);
      nameEl.appendChild(secondary);
    }

    const trailing = document.createElement("div");
    trailing.className = "model-item-trailing";

    const check = document.createElement("span");
    check.className = "codicon codicon-check";

    trailing.appendChild(check);
    row.appendChild(nameEl);
    row.appendChild(trailing);

    row.addEventListener("click", async () => {
      appState.selectedModel = name;
      localStorage.setItem("pointer:model", appState.selectedModel);
      syncModelLabel();
      closeModelMenu();
      modelPicker.focus();
      if (isOpenRouterProvider()) await applyOpenRouterModelDefaults(name);
      else await refreshModelContextCapacity();
      renderModelList();
      updateContextUsage();
    });

    modelList.appendChild(row);
  }

  if (!modelMenu.hidden) {
    requestAnimationFrame(() => positionModelMenu());
  }
}

export async function openModelMenu() {
  closeModelEditMenu();
  closeContextPopover();
  closeChatModeMenu();
  closeAuthorityMenu();
  modelMenu.style.visibility = "hidden";
  modelMenu.hidden = false;
  modelBrowseTrigger.setAttribute("aria-expanded", "true");
  modelPicker.classList.add("open");
  if (appState.allModels.length) renderModelList();
  else showModelListLoading();
  positionModelMenu();
  modelMenu.style.visibility = "visible";
  await loadModels({ showLoading: !appState.allModels.length });
  if (modelMenu.hidden) return;
  positionModelMenu();
  modelSearch.focus();
}

export function addCustomModel() {
  const name = addCustomModelName(modelCustom.value);
  if (!name) return;
  appState.selectedModel = name;
  localStorage.setItem("pointer:model", appState.selectedModel);
  modelCustom.value = "";
  modelAddForm.hidden = true;
  syncModelLabel();
  renderModelList();
  renderModelsSettingsList();
  renderExploreSubagentSelect();
  updateContextUsage();
  closeModelMenu();
}
