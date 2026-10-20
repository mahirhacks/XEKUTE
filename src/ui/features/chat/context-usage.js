import { ContextBudget, MessageIdentity } from "../../core/runtime-globals.js";
import { appState } from "../../core/app-state.js";
import { isOpenRouterProvider, CONTEXT_USAGE_ROW_LABELS } from "../../bootstrap.js";
import { closeModelMenu } from "../models/model-picker.js";
import {
  contextPreferenceFor, resolveModelContextPlan, refreshModelContextCapacity, AUTO_CONTEXT,
  AUTO_CONTEXT_ESTIMATE, getModelSettings,
} from "../models/model-settings.js";
import { getActiveFileContext } from "./prompt-context.js";
import { setContextCheckpointUi, checkpointNoticeHost } from "./context-checkpoints.js";
import { isInternalRuntimeInputMessage } from "./turn-structure.js";
import { activeChatSession, syncActiveChatSession } from "./chat-sessions.js";
import { memoryRecord, schedulePersistChatSessions } from "./chat-persistence.js";
import { formatContextWindowLabel, formatTokenCount, escapeHtml } from "../../core/text-format.js";
import {
  contextUsageBtn, contextRingFill, contextUsageHeadingValue, contextUsageFill, contextUsageUsed,
  contextUsagePct, contextUsageBreakdown, contextUsageSource, contextUsageSegments,
  contextUsageMenu, contextWindowValue, contextBlocksValue, contextBlocksList, memorySaveBanner,
  contextUsagePopover, contextWindowTrigger, contextBlocksTrigger, contextBlocksPanel,
} from "../../core/dom-refs.js";
import { canonicalChatMode } from "./chat-mode.js";
import { isChatSessionRunning, chatRunContainer } from "./chat-run-state.js";
import { closeChatHistoryPopover } from "./chat-history-popover.js";

export const CONTEXT_USAGE_SECTIONS = Object.freeze([
  Object.freeze({ key: "system_prompt", label: "System Prompt", color: "#a7a7ab" }),
  Object.freeze({ key: "tool_definitions", label: "Tool Definitions", color: "#77a8d8" }),
  Object.freeze({ key: "rules", label: "Rules", color: "#67b7a5" }),
  Object.freeze({ key: "skills", label: "Skills", color: "#d58dbc" }),
  Object.freeze({ key: "subagents", label: "Subagents", color: "#b58de8" }),
  Object.freeze({ key: "mcp", label: "MCP", color: "#e0a15d" }),
  Object.freeze({ key: "summarized_conversation", label: "Summarized Conversation", color: "#8ca6e8" }),
  Object.freeze({ key: "active_conversation", label: "Active Conversation", color: "#5d9ee8" }),
  Object.freeze({ key: "current_workflow", label: "Current Workflow", color: "#67b7a5" }),
]);

export const CONTEXT_USAGE_SECTION_ALIASES = Object.freeze({
  system: "system_prompt",
  system_prompt: "system_prompt",
  tool_definitions: "tool_definitions",
  tools: "tool_definitions",
  mcp: "mcp",
  mcp_definitions: "mcp",
  conversation: "active_conversation",
  active_conversation: "active_conversation",
  summarized_conversation: "summarized_conversation",
  active_workflow: "current_workflow",
  current_workflow: "current_workflow",
  checkpoint: "summarized_conversation",
  rules: "rules",
  authority: "rules",
  skills: "skills",
  subagents: "subagents",
  knowledge: "skills",
  knowledge_lease: "skills",
});

export const CONTEXT_RING_R = 8;
export const CONTEXT_RING_C = 2 * Math.PI * CONTEXT_RING_R;
export const estimateTokens = ContextBudget.estimateTokenCount;

export function estimateMessagesTokens(msgs) {
  return msgs.reduce((sum, m) => {
    let t = estimateTokens(m.content || "") + 4;
    if (m.tool_calls?.length) {
      t += estimateTokens(JSON.stringify(m.tool_calls));
    }
    if (m.tool_name) t += estimateTokens(m.tool_name) + 2;
    return sum + t;
  }, 0);
}

export function contextPreviewRoute(requestText = "") {
  const activeFile = getActiveFileContext();
  return globalThis.XekuteContextRouter?.routeRequest({
    text: requestText,
    hasWorkspace: Boolean(appState.rootPath),
    family: appState.chatFamily,
    mode: appState.chatMode,
    activeFile,
  }) || {
    kind: "conversation",
    promptDepth: "compact",
    toolCategories: [],
    cyberCapabilities: [],
    includeWorkspaceContext: false,
    includeMemory: false,
    interactionType: "conversation",
  };
}

export function resolvedWorkingContextPlan(modelName = appState.selectedModel) {
  const provider = isOpenRouterProvider() ? "openrouter" : "ollama";
  const cached = appState.resolvedContextCapacity?.plan;
  const metadata = (cached?.model === modelName && cached?.metadata)
    || (provider === "openrouter" ? (appState.openRouterModelMeta[modelName] || {}) : {});
  const preference = contextPreferenceFor(modelName);
  const runtime = cached?.model === modelName && cached?.source === "runtime" && cached.modelMaxTokens
    ? { contextLength: cached.modelMaxTokens }
    : null;
  const runtimeUsable = runtime && (
    preference.mode !== "custom"
    || !preference.limitTokens
    || preference.limitTokens <= runtime.contextLength
  );
  return resolveModelContextPlan(modelName, metadata, runtimeUsable ? runtime : null);
}

export function workingHistoryMessages(history = appState.chatHistory, session = activeChatSession()) {
  const source = MessageIdentity?.ensureMessageIdentity
    ? MessageIdentity.ensureMessageIdentity(history, session?.id || "chat")
    : (Array.isArray(history) ? history : []);
  const visibleSource = source.filter((message) => !isInternalRuntimeInputMessage(message));
  return visibleSource;
}

export function splitGuidanceContextForUsage(value = "") {
  const source = String(value || "").trim();
  if (!source) return { system: "", rules: "", skills: "", subagents: "" };
  const markers = [...source.matchAll(/^\[(RULES|SKILLS|SUBAGENTS)\s*[·|]\s*[^\]]+\]/gim)];
  if (!markers.length) return { system: source, rules: "", skills: "", subagents: "" };
  const buckets = { system: source.slice(0, markers[0].index).trim(), rules: [], skills: [], subagents: [] };
  for (let index = 0; index < markers.length; index += 1) {
    const match = markers[index];
    const end = markers[index + 1]?.index ?? source.length;
    const block = source.slice(match.index, end).trim();
    const kind = match[1].toUpperCase();
    if (kind === "RULES") buckets.rules.push(block);
    else if (kind === "SKILLS") buckets.skills.push(block);
    else buckets.subagents.push(block);
  }
  return {
    system: buckets.system,
    rules: buckets.rules.join("\n\n"),
    skills: buckets.skills.join("\n\n"),
    subagents: buckets.subagents.join("\n\n"),
  };
}

export function normalizeContextUsageSections(sections = [], { legacyToolTokens = 0 } = {}) {
  const totals = new Map(CONTEXT_USAGE_SECTIONS.map((section) => [section.key, 0]));
  for (const section of Array.isArray(sections) ? sections : []) {
    const sourceKey = String(section?.key || "").trim().toLowerCase();
    const tokens = Math.max(0, Number(section?.tokens) || 0);
    if (sourceKey === "system_tools") {
      const toolTokens = Math.min(tokens, Math.max(0, Number(legacyToolTokens) || 0));
      totals.set("tool_definitions", totals.get("tool_definitions") + toolTokens);
      totals.set("system_prompt", totals.get("system_prompt") + tokens - toolTokens);
      continue;
    }
    const key = CONTEXT_USAGE_SECTION_ALIASES[sourceKey] || "active_conversation";
    totals.set(key, totals.get(key) + tokens);
  }
  return CONTEXT_USAGE_SECTIONS.map((section) => ({ ...section, tokens: totals.get(section.key) || 0 }));
}

export function emptyContextUsageSections() {
  return CONTEXT_USAGE_SECTIONS.map((section) => ({ ...section, tokens: 0 }));
}

export function getContextBreakdown() {
  const storedUsage = normalizeContextUsageSnapshot(activeChatSession()?.lastContextUsage);
  const storedIsTier1 = Boolean(storedUsage && storedUsage.source === "estimate");
  const sections = storedIsTier1
    ? normalizeContextUsageSections(storedUsage.sections).map((section) => ({ ...section }))
    : emptyContextUsageSections();
  const estimatedTotal = sections.reduce((sum, section) => sum + section.tokens, 0);
  return {
    sections,
    summaryTokens: sections.find((section) => section.key === "summarized_conversation")?.tokens || 0,
    liveChatTokens: sections.find((section) => section.key === "active_conversation")?.tokens || 0,
    draftTokens: 0,
    streamTokens: 0,
    visibleComposerTokens: 0,
    toolTokens: sections.find((section) => section.key === "tool_definitions")?.tokens || 0,
    estimatedTotal,
    route: contextPreviewRoute(""),
    tools: [],
    messages: [],
    blocks: storedIsTier1 ? (storedUsage.blocks || []) : [],
    pinBudgetTokens: storedIsTier1 ? storedUsage.pinBudgetTokens || null : null,
    authoritative: storedIsTier1,
  };
}

export function normalizeContextUsageSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const promptTokens = Number(value.promptTokens);
  if (!Number.isFinite(promptTokens) || promptTokens < 0) return null;
  const contextWindow = Number(value.contextWindow);
  const effectiveLimitTokens = Number(value.effectiveLimitTokens);
  const promptBudgetTokens = Number(value.promptBudgetTokens);
  const sections = normalizeContextUsageSections((Array.isArray(value.sections) ? value.sections : []).slice(0, 32).map((section) => ({
    key: String(section?.key || "context").slice(0, 40),
    label: String(section?.label || "Context").slice(0, 80),
    color: /^#[0-9a-f]{6}$/i.test(String(section?.color || "")) ? section.color : "#a7a7ab",
    tokens: Math.max(0, Number(section?.tokens) || 0),
  })));
  const source = ["ollama", "openrouter", "estimate"].includes(value.source) ? value.source : "estimate";
  return {
    version: 3,
    source,
    provider: ["ollama", "openrouter"].includes(value.provider) ? value.provider : source === "openrouter" ? "openrouter" : source === "ollama" ? "ollama" : null,
    model: String(value.model || "").slice(0, 240),
    promptTokens,
    completionTokens: Number.isFinite(Number(value.completionTokens)) ? Math.max(0, Number(value.completionTokens)) : null,
    contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null,
    modelMaxTokens: Number.isFinite(Number(value.modelMaxTokens)) && Number(value.modelMaxTokens) > 0 ? Number(value.modelMaxTokens) : null,
    effectiveLimitTokens: Number.isFinite(effectiveLimitTokens) && effectiveLimitTokens > 0 ? effectiveLimitTokens : null,
    promptBudgetTokens: Number.isFinite(promptBudgetTokens) && promptBudgetTokens > 0 ? promptBudgetTokens : null,
    responseReserveTokens: Number.isFinite(Number(value.responseReserveTokens)) && Number(value.responseReserveTokens) > 0 ? Number(value.responseReserveTokens) : null,
    safetyMarginTokens: Number.isFinite(Number(value.safetyMarginTokens)) && Number(value.safetyMarginTokens) > 0 ? Number(value.safetyMarginTokens) : null,
    contextWindowSource: ["manual", "runtime", "catalog", "detail", "fallback"].includes(value.contextWindowSource) ? value.contextWindowSource : "fallback",
    approximate: Boolean(value.approximate),
    estimatedTokens: Math.max(0, Number(value.estimatedTokens) || promptTokens),
    compressionRatio: Number.isFinite(Number(value.compressionRatio)) && Number(value.compressionRatio) > 0 ? Number(value.compressionRatio) : null,
    sourcesRepresented: Math.max(0, Number(value.sourcesRepresented) || 0),
    freshness: ["Current", "Updating", "Stale", "Error"].includes(String(value.freshness)) ? String(value.freshness) : "Current",
    compileLatencyMs: Number.isFinite(Number(value.compileLatencyMs)) && Number(value.compileLatencyMs) >= 0 ? Number(value.compileLatencyMs) : null,
    knowledgeLease: value.knowledgeLease && typeof value.knowledgeLease === "object" ? { id: String(value.knowledgeLease.id || "").slice(0, 160), expiresOn: String(value.knowledgeLease.expiresOn || "compression_or_close").slice(0, 80) } : null,
    reasoningTokens: Number.isFinite(Number(value.reasoningTokens)) ? Math.max(0, Number(value.reasoningTokens)) : null,
    cachedTokens: Number.isFinite(Number(value.cachedTokens)) ? Math.max(0, Number(value.cachedTokens)) : null,
    cost: Number.isFinite(Number(value.cost)) ? Math.max(0, Number(value.cost)) : null,
    sections,
    blocks: globalThis.XekuteContextBlocksView?.normalizeContextBlocks(value.blocks) || [],
    pinBudgetTokens: Number.isFinite(Number(value.pinBudgetTokens)) && Number(value.pinBudgetTokens) > 0 ? Math.floor(Number(value.pinBudgetTokens)) : null,
    toolNames: (Array.isArray(value.toolNames) ? value.toolNames : []).slice(0, 64).map((name) => String(name).slice(0, 100)),
    route: value.route && typeof value.route === "object" ? {
      kind: String(value.route.kind || "conversation").slice(0, 40),
      promptDepth: String(value.route.promptDepth || "compact").slice(0, 40),
      toolCategories: (Array.isArray(value.route.toolCategories) ? value.route.toolCategories : []).slice(0, 2).map(String),
    } : null,
    round: Math.max(1, Number(value.round) || 1),
    measuredAt: String(value.measuredAt || new Date().toISOString()).slice(0, 40),
  };
}

export function storeLastContextUsage(value, {
  session = activeChatSession(),
  model = appState.selectedModel,
  contextPlan = null,
} = {}) {
  const usage = normalizeContextUsageSnapshot(value);
  if (!usage || !session) return null;
  const plan = contextPlan || resolvedWorkingContextPlan();
  const provider = plan.provider || (isOpenRouterProvider() ? "openrouter" : "ollama");
  if (usage.model && model && usage.model !== model) return null;
  usage.provider = usage.provider || provider;
  usage.model = usage.model || model || "";
  usage.modelMaxTokens = plan.modelMaxTokens || usage.modelMaxTokens || null;
  usage.effectiveLimitTokens = plan.effectiveLimitTokens || usage.effectiveLimitTokens;
  usage.contextWindow = usage.effectiveLimitTokens || plan.effectiveLimitTokens;
  usage.promptBudgetTokens = plan.promptBudgetTokens || usage.promptBudgetTokens;
  usage.responseReserveTokens = plan.responseReserveTokens || usage.responseReserveTokens;
  usage.safetyMarginTokens = plan.safetyMarginTokens || usage.safetyMarginTokens;
  usage.contextWindowSource = usage.contextWindowSource === "fallback" && plan.source !== "fallback" ? plan.source : usage.contextWindowSource;
  usage.approximate = usage.approximate || plan.approximate;
  session.lastContextUsage = usage;
  const summarizedTokens = usage.sections?.find((section) => section.key === "summarized_conversation")?.tokens;
  if (Number(summarizedTokens) > 0) {
    const memory = memoryRecord(session);
    memory.checkpointTokens = Number(summarizedTokens);
    if (memory.status === "empty") memory.status = "ready";
  }
  if (session.id === appState.activeChatSessionId) syncActiveChatSession();
  else schedulePersistChatSessions();
  return usage;
}

export async function refreshStoredContextCapacity() {
  await refreshModelContextCapacity();
  const session = activeChatSession();
  const usage = normalizeContextUsageSnapshot(session?.lastContextUsage);
  if (!usage || !appState.selectedModel) return;
  if (usage.model && usage.model !== appState.selectedModel) return;
  const plan = resolvedWorkingContextPlan();
  usage.model = appState.selectedModel;
  usage.provider = plan.provider;
  usage.modelMaxTokens = plan.modelMaxTokens || usage.modelMaxTokens;
  usage.effectiveLimitTokens = plan.effectiveLimitTokens;
  usage.contextWindow = plan.effectiveLimitTokens;
  usage.promptBudgetTokens = plan.promptBudgetTokens;
  usage.responseReserveTokens = plan.responseReserveTokens;
  usage.safetyMarginTokens = plan.safetyMarginTokens;
  usage.contextWindowSource = plan.source;
  usage.approximate = plan.approximate;
  session.lastContextUsage = usage;
  syncActiveChatSession();
  updateContextUsage();
}

export function getContextUsage(usedOverride = null) {
  const settings = appState.selectedModel ? getModelSettings(appState.selectedModel) : { context: AUTO_CONTEXT };
  const plan = resolvedWorkingContextPlan();
  const storedCandidate = normalizeContextUsageSnapshot(activeChatSession()?.lastContextUsage);
  const stored = storedCandidate && storedCandidate.source === "estimate" ? storedCandidate : null;
  const breakdown = getContextBreakdown();
  const total = plan.effectiveLimitTokens || appState.resolvedContextCapacity.tokens || AUTO_CONTEXT_ESTIMATE;
  const capacityApproximate = Boolean(plan.approximate);
  const promptBudget = plan.promptBudgetTokens || total;
  const used = breakdown.estimatedTotal;
  const pct = total > 0 ? Math.min(used / total, 1) : 0;
  const compactionPct = promptBudget > 0 ? Math.min(used / promptBudget, 1) : pct;
  return {
    total,
    promptBudget,
    used,
    free: Math.max(total - used, 0),
    pct,
    compactionPct,
    contextLabel: settings.context === AUTO_CONTEXT
      ? `Auto · ${capacityApproximate ? "~" : ""}${formatContextWindowLabel(total)} working budget`
      : `${formatContextWindowLabel(total)} working budget`,
    modelMaxTokens: plan.modelMaxTokens || stored?.modelMaxTokens || null,
    promptBudgetTokens: plan.promptBudgetTokens || stored?.promptBudgetTokens || null,
    responseReserveTokens: plan.responseReserveTokens || stored?.responseReserveTokens || null,
    provider: stored?.provider || plan.provider,
    model: stored?.model || plan.model,
    contextWindowSource: stored?.contextWindowSource || plan.source,
    compressionRatio: stored?.compressionRatio || null,
    sourcesRepresented: stored?.sourcesRepresented || 0,
    freshness: stored?.freshness || "Current",
    compileLatencyMs: stored?.compileLatencyMs ?? null,
    knowledgeLease: stored?.knowledgeLease || null,
    breakdown,
    source: "estimate",
    capacityApproximate,
  };
}

export function renderContextUsage({ total, used, free, pct, source, breakdown = getContextBreakdown(), capacityApproximate = true, provider = "ollama", model = "", modelMaxTokens = null, promptBudgetTokens = null, responseReserveTokens = null, contextWindowSource = "fallback", compressionRatio = null, sourcesRepresented = 0, freshness = "Current", compileLatencyMs = null }) {
  if (!contextRingFill) return;
  const displaySections = normalizeContextUsageSections(breakdown.sections);
  const sectionTotal = displaySections.reduce((sum, section) => sum + section.tokens, 0);
  const displayUsed = sectionTotal > 0 ? sectionTotal : Math.max(0, Number(used) || 0);
  const displayPct = total > 0 ? Math.min(displayUsed / total, 1) : 0;
  const filled = displayPct * CONTEXT_RING_C;
  const displayFree = Math.max(total - displayUsed, 0);

  contextRingFill.style.strokeDasharray = `${filled} ${CONTEXT_RING_C}`;
  contextUsageBtn.classList.toggle("warn", displayPct >= 0.75 && displayPct < 0.9);
  contextUsageBtn.classList.toggle("full", displayPct >= 0.9);

  if (contextUsageFill) {
    contextUsageFill.style.width = `${displayPct * 100}%`;
    contextUsageFill.classList.toggle("warn", displayPct >= 0.75 && displayPct < 0.9);
    contextUsageFill.classList.toggle("full", displayPct >= 0.9);
  }
  const displayCapacity = Number(total) > 0 ? Number(total) : (Number(modelMaxTokens) || 0);
  const windowLabel = `${formatTokenCount(Math.round(displayUsed))} / ${formatContextWindowLabel(Math.round(displayCapacity))}`;
  if (contextUsageHeadingValue) contextUsageHeadingValue.textContent = windowLabel;
  if (contextWindowValue) contextWindowValue.textContent = windowLabel;
  if (contextUsageUsed) contextUsageUsed.textContent = `${Math.round(displayPct * 100)}%`;
  if (contextUsagePct) {
    contextUsagePct.textContent = `Next prompt estimate · ${formatTokenCount(displayFree)} free`;
  }
  if (contextUsageSource) {
    contextUsageSource.textContent = breakdown?.authoritative ? "Tier 1 estimate" : "Estimate";
  }
  if (contextUsageSegments) {
    const segments = displaySections
      .filter((section) => section.tokens > 0)
      .map((section) => {
        const widthPct = Math.max((section.tokens / Math.max(total, 1)) * 100, 1);
        const label = CONTEXT_USAGE_ROW_LABELS[section.key] || section.label;
        return `<span class="context-usage-segment" style="width:${widthPct}%;background:${section.color}" title="${escapeHtml(label)}: ${escapeHtml(formatTokenCount(section.tokens))}"></span>`;
      });
    contextUsageSegments.innerHTML = segments.join("");
  }
  if (contextUsageBreakdown) {
    const rows = displaySections
      .map((section) => {
        return `
          <div class="context-usage-row">
            <div class="context-usage-row-label">
              <span class="context-usage-swatch" style="background:${section.color}"></span>
              <span>${escapeHtml(CONTEXT_USAGE_ROW_LABELS[section.key] || section.label)}</span>
            </div>
            <div class="context-usage-row-value">${escapeHtml(formatTokenCount(section.tokens))}</div>
          </div>
        `;
      });
    contextUsageBreakdown.innerHTML = rows.join("");
  }
  renderContextBlocksPanel(breakdown.blocks, breakdown.pinBudgetTokens);
  setContextCheckpointUi(appState.contextCheckpointing);
  if (contextUsageMenu && !contextUsageMenu.hidden) {
    requestAnimationFrame(positionContextPopover);
  }
}

// The nine meter rows are Tier 1 accounting, so an idle chat has to ask Tier 1
// for them instead of estimating locally. This keeps every category live from
// the moment a session is opened, rather than only after the first send.
export function tier1PreviewSignature() {
  const session = activeChatSession();
  if (!session || !appState.rootPath || !appState.selectedModel) return "";
  const plan = resolvedWorkingContextPlan();
  return [
    appState.rootPath,
    session.memorySessionId || session.id,
    appState.selectedModel,
    canonicalChatMode(session.chatMode || appState.chatMode),
    session.chatFamily || appState.chatFamily,
    appState.authoritySettingsData?.superMode || "",
    plan.effectiveLimitTokens || 0,
  ].join("|");
}

export function scheduleTier1ContextPreview({ force = false } = {}) {
  if (typeof window.api?.contextTier1Usage !== "function") return;
  const signature = tier1PreviewSignature();
  if (!signature) return;
  if (!force && signature === appState.tier1PreviewSignatureValue) return;
  appState.tier1PreviewSignatureValue = signature;
  clearTimeout(appState.tier1PreviewTimer);
  appState.tier1PreviewTimer = setTimeout(() => { void refreshTier1ContextPreview(signature); }, 150);
}

export async function refreshTier1ContextPreview(signature) {
  const session = activeChatSession();
  if (!session || appState.tier1PreviewInFlight) return;
  // A live run publishes its own Tier 1 snapshots; never overwrite them with a
  // preview taken between two model rounds.
  if (isChatSessionRunning(session.id)) return;
  appState.tier1PreviewInFlight = true;
  try {
    const plan = resolvedWorkingContextPlan();
    const response = await window.api.contextTier1Usage({
      workspace: appState.rootPath || "",
      model: appState.selectedModel,
      mode: canonicalChatMode(session.chatMode || appState.chatMode),
      modeFamily: session.chatFamily || appState.chatFamily,
      authorityProfile: appState.authoritySettingsData?.superMode || "",
      contextPlan: plan,
      numCtx: plan.provider === "ollama" ? plan.effectiveLimitTokens : null,
      contextBudget: plan.effectiveLimitTokens,
      sessionId: session.memorySessionId || "",
      // A fork has the transcript locally and no Tier 1 ledger yet. The meter
      // has to count those messages, not an empty memory session.
      chatHistory: workingHistoryMessages(session.history, session),
    });
    const usage = response?.usage || response?.value?.usage || null;
    if (!usage) return;
    // The selection can change while the assembly is in flight; a stale answer
    // must not replace the rows for a different session, mode, or model.
    if (signature !== tier1PreviewSignature() || isChatSessionRunning(session.id)) return;
    storeLastContextUsage(usage, { session, model: appState.selectedModel, contextPlan: plan });
    if (session.id === appState.activeChatSessionId) renderContextUsage(getContextUsage());
  } catch { /* the meter keeps its last Tier 1 snapshot */ }
  finally { appState.tier1PreviewInFlight = false; }
}

export function updateContextUsage() {
  renderContextUsage(getContextUsage());
  scheduleTier1ContextPreview();
}

// Pinning is stored by the main process; the meter only mirrors the answer.
export async function pinContextBlock(index, pinned) {
  const session = activeChatSession();
  if (!session || typeof window.api?.contextPinBlock !== "function") return;
  try {
    const response = await window.api.contextPinBlock({ workspace: appState.rootPath || "", memorySessionId: session.memorySessionId || "", index, pinned });
    if (!response?.ok) return;
    const block = (session.lastContextUsage?.blocks || []).find((entry) => entry.index === index);
    if (block) block.pinned = response.pinned === true;
    renderContextUsage(getContextUsage());
    scheduleTier1ContextPreview({ force: true });
  } catch { /* the meter keeps showing the last pin state */ }
}

// The block count stays in the first menu; the list lives in its own panel.
export function renderContextBlocksPanel(blocks, pinBudgetTokens = null) {
  const view = globalThis.XekuteContextBlocksView;
  const list = view?.normalizeContextBlocks?.(blocks) || [];
  if (contextBlocksValue) contextBlocksValue.textContent = String((view?.visibleContextBlocks?.(list) || list).length);
  if (!contextBlocksList) return;
  contextBlocksList.innerHTML = view?.renderContextBlocksHtml(list, { escapeHtml, formatTokenCount, pinBudgetTokens })
    || `<div class="context-blocks-heading"><span>Conversation blocks</span></div><div class="context-blocks-empty">No turns in this conversation yet.</div>`;
}

// While this chat's memory cannot be saved, a banner above the composer says
// so until the next save succeeds. Closing it hides it for this failure only.
export const MEMORY_SAVE_REASONS = {
  secure_storage: "the system's secure storage is unavailable",
  disk_full: "the disk is full",
  no_access: "the memory folder cannot be written to",
  write_failed: "the memory folder cannot be written to",
};
export function renderMemorySaveBanner() {
  if (!memorySaveBanner) return;
  const session = activeChatSession();
  const health = session?.memorySaveHealth || null;
  const show = Boolean(health) && session.memorySaveDismissed !== health.reason;
  memorySaveBanner.hidden = !show;
  if (!show) return;
  const reason = MEMORY_SAVE_REASONS[health.reason] || MEMORY_SAVE_REASONS.write_failed;
  memorySaveBanner.querySelector(".memory-save-banner-text").textContent = `Memory can't be saved because ${reason}. This chat will lose its earlier context if you restart the app.`;
}

// Released blocks are shown in the chat the same way a checkpoint is, so the
// operator can see why earlier turns left the model's context.
export function applyContextReleaseUi(run, payload = {}) {
  if (String(payload.status || "").toLowerCase() !== "completed") return;
  const count = Array.isArray(payload.indices) ? payload.indices.length : 0;
  if (!count) return;
  const freed = Math.max(0, Number(payload.tokensFreed) || 0);
  const host = checkpointNoticeHost(chatRunContainer(run));
  if (host) {
    const notice = document.createElement("div");
    notice.className = "context-checkpoint-notice";
    notice.dataset.state = "complete";
    notice.dataset.contextRelease = "true";
    notice.setAttribute("role", "status");
    const label = document.createElement("span");
    label.className = "context-checkpoint-text";
    label.textContent = `Released ${count} earlier ${count === 1 ? "turn" : "turns"} from context${freed ? ` · ${formatTokenCount(freed)} freed` : ""}`;
    notice.append(label);
    // Placed in the stream where the release happened, like a summary notice,
    // so a turn reads top to bottom in order.
    if (run?.assistant?.splitAtContextCheckpoint) run.assistant.splitAtContextCheckpoint(notice);
    else host.appendChild(notice);
  }
  const session = run?.session;
  if (session && appState.activeChatSessionId === session.id && !run?.viewHost) updateContextUsage();
}

// Like the model picker: a small menu above the ring, and each row's panel
// beside the menu (left of it when the right edge is too close).
export function positionContextMenuPanel(panel, row) {
  const pad = 8;
  const parent = contextUsageMenu.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  let left = parent.right + 4;
  if (left + width > window.innerWidth - pad) left = parent.left - width - 4;
  const top = Math.min(rowRect.top, parent.bottom - height);
  panel.style.left = `${Math.max(pad, Math.min(left, window.innerWidth - width - pad))}px`;
  panel.style.top = `${Math.max(pad, Math.min(top, window.innerHeight - height - pad))}px`;
}

export function positionContextPopover() {
  if (!contextUsageMenu || contextUsageMenu.hidden || !contextUsageBtn) return;
  const pad = 8;
  const rect = contextUsageBtn.getBoundingClientRect();
  const width = contextUsageMenu.offsetWidth;
  const height = contextUsageMenu.offsetHeight;
  let top = rect.top - height - pad;
  if (top < pad) top = rect.bottom + pad;
  contextUsageMenu.style.left = `${Math.max(pad, Math.min(rect.right - width, window.innerWidth - width - pad))}px`;
  contextUsageMenu.style.top = `${Math.max(pad, Math.min(top, window.innerHeight - height - pad))}px`;
  if (!contextUsagePopover.hidden) positionContextMenuPanel(contextUsagePopover, contextWindowTrigger);
  if (contextBlocksPanel && !contextBlocksPanel.hidden) positionContextMenuPanel(contextBlocksPanel, contextBlocksTrigger);
}

// Opens one row's panel and closes the other; a second click on the same row closes it.
export function showContextPanel(panel) {
  const panels = [[contextUsagePopover, contextWindowTrigger], [contextBlocksPanel, contextBlocksTrigger]];
  for (const [candidate, trigger] of panels) {
    if (!candidate || !trigger) continue;
    const open = candidate === panel && candidate.hidden;
    candidate.hidden = !open;
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
  }
  positionContextPopover();
}

export function closeContextPopover() {
  if (!contextUsageMenu) return;
  contextUsageMenu.hidden = true;
  contextUsagePopover.hidden = true;
  if (contextBlocksPanel) contextBlocksPanel.hidden = true;
  contextWindowTrigger?.setAttribute("aria-expanded", "false");
  contextBlocksTrigger?.setAttribute("aria-expanded", "false");
  contextUsageBtn?.classList.remove("active");
  contextUsageBtn?.setAttribute("aria-expanded", "false");
}

export function openContextPopover() {
  closeModelMenu();
  closeChatHistoryPopover();
  updateContextUsage();
  contextUsageMenu.hidden = false;
  contextUsageBtn.classList.add("active");
  contextUsageBtn.setAttribute("aria-expanded", "true");
  positionContextPopover();
  contextWindowTrigger?.focus();
}

export function toggleContextPopover() {
  if (contextUsageMenu.hidden) openContextPopover();
  else closeContextPopover();
}
