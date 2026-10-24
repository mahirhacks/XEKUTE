import {
  messages, chatInput, activityChat, btnTopChat, chatPane, chatResize, chatSessionSelect,
  btnChatNew, btnChatDelete,
} from "../../core/dom-refs.js";
import { appState } from "../../core/app-state.js";
import {
  stashActiveChatRunView, activeChatRuns, hydratePersistedChatTranscript, isChatSessionRunning,
  isRunningChatActive,
} from "./chat-run-state.js";
import { hasStructuredTranscript, normalizeUiTranscript, captureChatSnapshot } from "./chat-transcript.js";
import { MessageIdentity } from "../../core/runtime-globals.js";
import {
  paintLiveInputRecord, memoryRecord, createChatSession, currentChatPersistenceScope,
  normalizePersistedChatSession, reportChatHistoryWarning, persistChatHistorySnapshot,
  clearScheduledChatPersistence, clearChatSessionState, sanitizePersistedChatHtml,
  schedulePersistChatSessions, queueChatHistoryEvent, activeChatHistoryContext,
} from "./chat-persistence.js";
import { normalizeChatExchanges } from "./turn-structure.js";
import {
  renderCanonicalChatHistory, restoreHistoryCommandContexts, renderStructuredChatTranscript,
  restoreHistorySubagentCards, captureSessionTranscript,
} from "./transcript-replay.js";
import {
  scheduleSubagentResultDrain, recoverPendingSubagentResults,
} from "../agents/parent-continuation.js";
import { ensureVisibleDelegatedPrompt } from "../agents/delegated-child-runs.js";
import {
  resizeChatInput, resetChatInput, migrateLegacyChatInputs, updateSendBtn,
} from "./composer-input.js";
import { setSelectedSlashCommand } from "./slash-commands.js";
import {
  clearComposerTaskList, renderComposerTaskList, syncComposerQuestionsForActiveSession,
} from "./composer-questions.js";
import {
  attachAssistantCopyButton, syncChatStickyMask, scrollMessages, hideChatErrorToast,
} from "./chat-messages.js";
import { renderMemorySaveBanner, updateContextUsage } from "./context-usage.js";
import {
  CHAT_MODE_KEY, CHAT_FAMILY_KEY, CHAT_FAMILIES, canonicalChatMode, syncChatModeUi,
} from "./chat-mode.js";
import {
  renderChatHistory, positionChatHistoryPopover, closeChatHistoryPopover,
} from "./chat-history-popover.js";
import { fileTagDisplayText } from "./file-tags.js";

export const chatSessionsNeedingAttention = new Set();

export const chatSessions = [];

export const closedChatSessions = [];
export const archivedChatSessions = [];

export function ensureChatEmptyState() {
  const empty = messages?.querySelector("#chat-empty-state");
  empty?.remove();
  return null;
}

export function syncChatEmptyState() {
  ensureChatEmptyState();
}

export function prepareActiveChatSessionForSwitch(nextSessionId = "") {
  const current = activeChatSession();
  if (!current || current.id === nextSessionId) return;

  current.draftText = chatInput?.value || "";
  current.draftSlashCommand = appState.selectedSlashCommand;
  syncActiveChatSession();
  stashActiveChatRunView(current);
}

export function applyActiveChatSession(session) {
  hideChatErrorToast();
  prepareActiveChatSessionForSwitch(session?.id || "");
  if (!session) {
    appState.activeChatSessionId = "";
    appState.browserWorkspace?.chatChanged();
    appState.chatHistory = [];
    appState.contextFilesCache = [];
    appState.activeStreamContent = "";
    messages.innerHTML = "";
    clearComposerTaskList();
    syncComposerQuestionsForActiveSession();
    setChatCollapsed(true);
    return;
  }
  appState.activeChatSessionId = session.id;
  appState.browserWorkspace?.chatChanged();
  renderMemorySaveBanner();
  session.history = MessageIdentity?.ensureMessageIdentity
    ? MessageIdentity.ensureMessageIdentity(session.history, session.id)
    : (Array.isArray(session.history) ? session.history : []);
  memoryRecord(session);
  appState.chatHistory = session.history;
  appState.contextFilesCache = [];
  appState.activeStreamContent = "";
  appState.chatFamily = CHAT_FAMILIES.has(session.chatFamily) ? session.chatFamily : appState.chatFamily;
  appState.chatMode = canonicalChatMode(session.chatMode);
  if (session.selectedModel) appState.selectedModel = session.selectedModel;
  localStorage.setItem(CHAT_MODE_KEY, appState.chatMode);
  localStorage.setItem(CHAT_FAMILY_KEY, appState.chatFamily);
  if (appState.selectedModel) localStorage.setItem("pointer:model", appState.selectedModel);
  const liveRun = activeChatRuns.get(session.id) || null;
  if (liveRun?.taskList) renderComposerTaskList(liveRun.taskList);
  else clearComposerTaskList();
  syncComposerQuestionsForActiveSession();
  let restoredHtml = false;
  if (liveRun?.viewHost) {
    messages.replaceChildren(...liveRun.viewHost.childNodes);
    liveRun.viewHost = null;
  } else if (hasStructuredTranscript(session.transcript)) {
    renderStructuredChatTranscript(session.transcript, messages);
    restoreHistorySubagentCards(session.history);
    hydratePersistedChatTranscript(messages);
  } else if (session.messagesHtml) {
    restoredHtml = true;
    messages.innerHTML = sanitizePersistedChatHtml(session.messagesHtml);
    hydratePersistedChatTranscript(messages);
    restoreHistorySubagentCards(session.history);
    // Normalize snapshots produced before the V3 checkpoint UI. The cursor is
    // model-only state; it must never hide or remove visible transcript rows.
    if (messages.querySelector(".chat-archive-marker")) {
      renderCanonicalChatHistory(session.history);
      restoredHtml = false;
    }
  }
  else {
    renderCanonicalChatHistory(session.history);
    restoreHistorySubagentCards(session.history);
  }
  restoreHistoryCommandContexts(messages, session.history);
  normalizeChatExchanges();
  ensureVisibleDelegatedPrompt(session);
  for (const record of session.liveInputs || []) paintLiveInputRecord(session, record);
  syncChatStickyMask();
  syncChatEmptyState();
  setChatCollapsed(false);
  chatSessionsNeedingAttention.delete(session.id);
  resetChatInput();
  if (chatInput) chatInput.value = session.draftText || "";
  setSelectedSlashCommand(session.draftSlashCommand || "");
  if (chatInput) {
    chatInput.disabled = false;
    chatInput.readOnly = false;
    chatInput.removeAttribute("aria-disabled");
  }
  appState.activeStreamContent = liveRun?.activeStreamContent || "";
  resizeChatInput();
  syncChatModeUi();
  updateSendBtn();
  queueMicrotask(() => migrateLegacyChatInputs(session));
  requestAnimationFrame(() => {
    if (restoredHtml) {
      messages.querySelectorAll(".assistant-reply[data-raw-md]").forEach((element) => {
        globalThis.MarkdownRenderer?.renderToElement(element, element.dataset.rawMd || "");
        attachAssistantCopyButton(element);
      });
    }
    scrollMessages({ force: true });
  });
  scheduleSubagentResultDrain();
}

export async function restoreChatSessionsForCurrentWorkspace() {
  const scope = currentChatPersistenceScope();
  if (scope === appState.activeChatPersistenceScope) return;
  clearScheduledChatPersistence();
  if (appState.activeChatPersistenceScope) await persistChatHistorySnapshot(appState.activeChatPersistenceScope);
  appState.activeChatPersistenceScope = scope;

  let saved;
  try {
    saved = scope ? await window.api.loadChatHistory?.({ workspace: scope }) : null;
  } catch (error) {
    console.warn("Could not load chat history:", error);
  }
  if (scope !== appState.activeChatPersistenceScope) return;

  const restored = saved?.exists
    ? (saved.sessions || []).map(normalizePersistedChatSession).filter(Boolean)
    : [];
  if (!restored.length) restored.push(createChatSession("New Agent"));
  const unique = new Map(restored.map((session) => [session.id, session]));
  chatSessions.splice(0, chatSessions.length, ...unique.values());
  const restoredClosed = (saved?.closedSessions || [])
    .map(normalizePersistedChatSession)
    .filter(Boolean);
  const existingIds = new Set(chatSessions.map((session) => session.id));
  closedChatSessions.splice(
    0,
    closedChatSessions.length,
    ...restoredClosed.filter((session) => !existingIds.has(session.id)),
  );
  const restoredArchived = (saved?.archivedSessions || [])
    .map(normalizePersistedChatSession)
    .filter(Boolean);
  const restoredIds = new Set([
    ...chatSessions.map((session) => session.id),
    ...closedChatSessions.map((session) => session.id),
  ]);
  archivedChatSessions.splice(
    0,
    archivedChatSessions.length,
    ...restoredArchived.filter((session) => !restoredIds.has(session.id)),
  );
  const active = chatSessions.find((session) => session.id === saved?.activeSessionId) || chatSessions[0] || null;
  applyActiveChatSession(active);
  renderChatSessionSelect();
  updateContextUsage();
  if (saved?.warning) reportChatHistoryWarning(saved.warning);
  await recoverPendingSubagentResults();
}

export function activeChatSession() {
  return chatSessions.find((session) => session.id === appState.activeChatSessionId) || null;
}

export function setChatCollapsed(collapsed) {
  appState.chatCollapsed = collapsed;
  chatPane?.classList.toggle("collapsed", collapsed);
  chatResize?.classList.toggle("collapsed", collapsed);
  btnTopChat?.classList.toggle("active", !collapsed);
  btnTopChat?.classList.toggle("inactive", collapsed);
  btnTopChat?.setAttribute("aria-pressed", String(!collapsed));
  activityChat?.classList.toggle("panel-visible", !collapsed);
  activityChat?.setAttribute("aria-pressed", String(!collapsed));
  if (!collapsed) {
    requestAnimationFrame(() => {
      resizeChatInput();
      chatInput?.focus();
    });
  }
}

export function ensureChatSession() {
  if (activeChatSession()) return activeChatSession();
  const session = createChatSession("New Agent");
  clearChatSessionState(session);
  chatSessions.push(session);
  appState.activeChatSessionId = session.id;
  appState.browserWorkspace?.chatChanged();
  appState.chatHistory = session.history;
  appState.contextFilesCache = session.contextFilesCache;
  appState.activeStreamContent = "";
  messages.innerHTML = "";
  syncChatEmptyState();
  return session;
}

export function openChatPane({ createIfEmpty = true } = {}) {
  if (createIfEmpty) ensureChatSession();
  setChatCollapsed(false);
  renderChatSessionSelect();
  updateContextUsage();
}

export function syncActiveChatSession({ persist = true } = {}) {
  const session = activeChatSession();
  if (!session) return;
  session.history = MessageIdentity?.ensureMessageIdentity
    ? MessageIdentity.ensureMessageIdentity(appState.chatHistory, session.id)
    : appState.chatHistory;
  appState.chatHistory = session.history;
  session.contextFilesCache = appState.contextFilesCache;
  session.activeStreamContent = appState.activeStreamContent;
  const snapshot = captureChatSnapshot(messages, sanitizePersistedChatHtml);
  session.messagesHtml = snapshot.messagesHtml;
  session.transcript = snapshot.transcript;
  session.chatMode = appState.chatMode;
  session.chatFamily = appState.chatFamily;
  session.selectedModel = appState.selectedModel;
  session.updatedAt = session.updatedAt || session.createdAt || new Date().toISOString();
  if (persist) schedulePersistChatSessions();
}

export function renderChatSessionSelect() {
  if (!chatSessionSelect) return;
  const signature = chatSessions.map((session) => [
    session.id,
    session.title || "",
    session.id === appState.activeChatSessionId ? "1" : "0",
    isChatSessionRunning(session.id) ? "1" : "0",
    chatSessionsNeedingAttention.has(session.id) ? "1" : "0",
  ].join("\u001f")).join("\u001e");
  if (signature === appState.chatSessionTabSignature && chatSessionSelect.childElementCount === chatSessions.length) {
    chatSessionSelect.classList.toggle("disabled", !chatSessions.length);
    return;
  }
  appState.chatSessionTabSignature = signature;
  chatSessionSelect.innerHTML = "";
  chatSessionSelect.classList.toggle("disabled", !chatSessions.length);

  chatSessions.forEach((session) => {
    const running = isChatSessionRunning(session.id);
    const needsAttention = !running && chatSessionsNeedingAttention.has(session.id);
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `chat-session-tab${session.id === appState.activeChatSessionId ? " active" : ""}${running ? " running" : ""}${needsAttention ? " needs-attention" : ""}`;
    tab.dataset.sessionId = session.id;
    tab.dataset.runState = running ? "running" : needsAttention ? "complete-unread" : "idle";
    const title = session.title || "New Agent";
    tab.title = running ? `${title} — Agent running` : needsAttention ? `${title} — Finished` : title;
    tab.setAttribute("aria-label", tab.title);

    const icon = document.createElement("span");
    icon.className = `codicon ${running ? "codicon-loading codicon-modifier-spin chat-tab-running-icon" : "codicon-file"} chat-title-icon`;

    const label = document.createElement("span");
    label.className = "chat-session-label";
    label.textContent = session.title || "New Agent";

    const attention = document.createElement("span");
    attention.className = "chat-tab-attention";
    attention.setAttribute("aria-hidden", "true");
    attention.hidden = !needsAttention;

    const close = document.createElement("span");
    close.className = "codicon codicon-close chat-tab-close";
    close.dataset.closeSession = session.id;
    close.title = "Close chat";
    close.hidden = running;

    tab.appendChild(icon);
    tab.appendChild(label);
    tab.appendChild(attention);
    tab.appendChild(close);
    chatSessionSelect.appendChild(tab);
  });

  if (btnChatDelete) btnChatDelete.disabled = isRunningChatActive();
  if (btnChatNew) btnChatNew.disabled = false;
}

export function scrollChatSessionIntoView(sessionId = appState.activeChatSessionId) {
  if (!chatSessionSelect || !sessionId) return;
  const tab = [...chatSessionSelect.querySelectorAll(".chat-session-tab")]
    .find((item) => item.dataset.sessionId === sessionId);
  if (!tab || typeof tab.scrollIntoView !== "function") return;
  requestAnimationFrame(() => {
    tab.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
  });
}

export function loadChatSession(id) {
  const session = chatSessions.find((item) => item.id === id);
  if (!session) {
    renderChatSessionSelect();
    return;
  }
  applyActiveChatSession(session);
  renderChatSessionSelect();
  updateContextUsage();
  schedulePersistChatSessions();
}

export function allKnownChatSessions() {
  return [...chatSessions, ...closedChatSessions, ...archivedChatSessions];
}

export function forkRootSessionId(session) {
  return String(session?.forkedFromSessionId || session?.id || "");
}

export function forkBaseTitle(session) {
  return String(session?.title || "New Agent").replace(/^\(\d+\)\s+/, "").trim() || "New Agent";
}

export function nextForkTitle(source) {
  const rootId = forkRootSessionId(source);
  const count = allKnownChatSessions().filter((session) => session?.forkedFromSessionId === rootId).length;
  return `(${count + 1}) ${forkBaseTitle(source)}`.slice(0, 120);
}

export function cloneSessionValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

export async function forkChatSession(sourceId = appState.activeChatSessionId) {
  const source = allKnownChatSessions().find((session) => session.id === sourceId);
  if (!source) return null;
  if (source.id === appState.activeChatSessionId) syncActiveChatSession({ persist: false });
  const fork = createChatSession(nextForkTitle(source));
  fork.forkedFromSessionId = forkRootSessionId(source);
  fork.history = cloneSessionValue(source.history || []);
  fork.messagesHtml = source.messagesHtml || "";
  fork.transcript = cloneSessionValue(source.transcript || { version: 1, runs: [] });
  fork.chatMode = source.chatMode;
  fork.chatFamily = source.chatFamily;
  fork.selectedModel = source.selectedModel;
  fork.contextFilesCache = cloneSessionValue(source.contextFilesCache || []);
  fork.currentWorkflow = cloneSessionValue(source.currentWorkflow);
  fork.lastContextUsage = cloneSessionValue(source.lastContextUsage);
  // A fork taken during a run ends at the last finished turn, like its memory
  // copy, which never includes the turn in progress.
  const runningPrompt = isChatSessionRunning(source.id) && Number.isInteger(source.memoryBlockHistoryStart) && source.memoryBlockHistoryStart >= 0
    ? source.memoryBlockHistoryStart : -1;
  if (runningPrompt >= 0) {
    const prompt = String(source.history?.[runningPrompt]?.content || "");
    fork.history = fork.history.slice(0, runningPrompt);
    const runs = normalizeUiTranscript(fork.transcript).runs;
    const running = runs.findLastIndex((run) => (run.timeline || []).some((item) => item.type === "user" && item.message && prompt.startsWith(item.message)));
    fork.transcript = { ...normalizeUiTranscript(fork.transcript), runs: running >= 0 ? runs.slice(0, running) : runs };
    fork.messagesHtml = "";
  }
  fork.kind = "chat";
  fork.memoryProjectId = source.memoryProjectId || "";
  fork.memorySessionId = "";
  fork.memoryBlockId = "";
  fork.memoryBlockHistoryStart = -1;
  const sourceMemoryId = String(source.memorySessionId || "");
  if (sourceMemoryId && appState.rootPath && typeof window.api?.forkTier1Session === "function") {
    try {
      const copied = await window.api.forkTier1Session({
        workspace: appState.rootPath,
        projectId: source.memoryProjectId || "",
        sourceSessionId: sourceMemoryId,
        destKey: fork.id,
      });
      if (copied?.ok && copied.sessionId) {
        fork.memorySessionId = copied.sessionId;
        fork.memoryProjectId = copied.projectId || fork.memoryProjectId;
      }
    } catch { /* the meter falls back to the copied transcript */ }
  }
  chatSessions.push(fork);
  applyActiveChatSession(fork);
  appState.contextFilesCache = Array.isArray(fork.contextFilesCache) ? fork.contextFilesCache : [];
  renderChatSessionSelect();
  scrollChatSessionIntoView(fork.id);
  updateContextUsage();
  schedulePersistChatSessions(fork);
  chatInput?.focus();
  return fork;
}

export function newChatSession() {
  const session = createChatSession("New Agent");
  clearChatSessionState(session);
  chatSessions.push(session);
  applyActiveChatSession(session);
  renderChatSessionSelect();
  scrollChatSessionIntoView(session.id);
  updateContextUsage();
  schedulePersistChatSessions();
  chatInput.focus();
}

// Closes a chat session: it is removed from the open tab strip but kept in
// storage so it still appears in chat history and can be reopened.
export function closeChatSession(id = appState.activeChatSessionId) {
  if (isChatSessionRunning(id)) return;
  const idx = chatSessions.findIndex((session) => session.id === id);
  if (idx < 0) return;
  const wasActive = id === appState.activeChatSessionId;
  if (wasActive) prepareActiveChatSessionForSwitch("");
  const [session] = chatSessions.splice(idx, 1);
  session.updatedAt = new Date().toISOString();
  // Avoid duplicate entries if the session somehow already exists as closed.
  if (!closedChatSessions.some((item) => item.id === session.id)) {
    closedChatSessions.push(session);
  }
  queueChatHistoryEvent({ type: "close", sessionId: session.memorySessionId || "" }, { session });
  if (!wasActive) {
    renderChatSessionSelect();
    schedulePersistChatSessions();
    return;
  }
  if (!chatSessions.length) {
    appState.activeChatSessionId = "";
    appState.chatHistory = [];
    appState.contextFilesCache = [];
    appState.activeStreamContent = "";
    messages.innerHTML = "";
    syncChatEmptyState();
    setChatCollapsed(true);
    renderChatSessionSelect();
    updateContextUsage();
    schedulePersistChatSessions();
    return;
  }
  const next = chatSessions[Math.max(0, Math.min(idx, chatSessions.length - 1))];
  applyActiveChatSession(next);
  renderChatSessionSelect();
  updateContextUsage();
  schedulePersistChatSessions();
  chatInput.focus();
}

// Permanently deletes a chat session from both open tabs and history.
export function destroyChatSession(id) {
  if (isChatSessionRunning(id)) return;
  chatSessionsNeedingAttention.delete(id);
  const memorySession = chatSessions.find((session) => session.id === id)
    || closedChatSessions.find((session) => session.id === id)
    || archivedChatSessions.find((session) => session.id === id);
  const historyContext = activeChatHistoryContext(memorySession);
  if (historyContext && window.api.deleteChatSession) {
    window.api.deleteChatSession({ workspace: historyContext.workspace, sessionId: historyContext.sessionId })
      .catch((error) => reportChatHistoryWarning(error));
  }
  const openIdx = chatSessions.findIndex((session) => session.id === id);
  if (openIdx >= 0) {
    if (id === appState.activeChatSessionId) prepareActiveChatSessionForSwitch("");
    clearChatSessionState(chatSessions[openIdx]);
    chatSessions.splice(openIdx, 1);
  } else {
    const closedIdx = closedChatSessions.findIndex((session) => session.id === id);
    if (closedIdx >= 0) {
      clearChatSessionState(closedChatSessions[closedIdx]);
      closedChatSessions.splice(closedIdx, 1);
    } else {
      const archivedIdx = archivedChatSessions.findIndex((session) => session.id === id);
      if (archivedIdx >= 0) {
        clearChatSessionState(archivedChatSessions[archivedIdx]);
        archivedChatSessions.splice(archivedIdx, 1);
      }
    }
  }
  if (id === appState.activeChatSessionId || !activeChatSession()) {
    if (!chatSessions.length) {
      appState.activeChatSessionId = "";
      appState.chatHistory = [];
      appState.contextFilesCache = [];
      appState.activeStreamContent = "";
      messages.innerHTML = "";
      syncChatEmptyState();
      setChatCollapsed(true);
    } else {
      const next = chatSessions[Math.max(0, Math.min(openIdx, chatSessions.length - 1))] || chatSessions[0];
      applyActiveChatSession(next);
    }
  }
  renderChatSessionSelect();
  updateContextUsage();
  schedulePersistChatSessions();
  if (chatSessions.length) chatInput.focus();
}

export function deleteActiveChatSession() {
  destroyChatSession(appState.activeChatSessionId);
}

export function archiveChatSession(id) {
  if (isChatSessionRunning(id)) return;
  if (archivedChatSessions.some((session) => session.id === id)) {
    unarchiveChatSession(id, { closePopover: false });
    renderChatHistory();
    positionChatHistoryPopover();
    return;
  }
  if (chatSessions.some((session) => session.id === id)) closeChatSession(id);
  const closedIdx = closedChatSessions.findIndex((session) => session.id === id);
  if (closedIdx >= 0) {
    const [session] = closedChatSessions.splice(closedIdx, 1);
    archivedChatSessions.push(session);
    queueChatHistoryEvent({ type: "archive", sessionId: session.memorySessionId || "" }, { session });
    schedulePersistChatSessions();
  }
  renderChatHistory();
  positionChatHistoryPopover();
}

export function unarchiveChatSession(id, { closePopover = true } = {}) {
  const archivedIdx = archivedChatSessions.findIndex((session) => session.id === id);
  if (archivedIdx < 0) return false;
  const [session] = archivedChatSessions.splice(archivedIdx, 1);
  chatSessions.push(session);
  applyActiveChatSession(session);
  queueChatHistoryEvent({ type: "unarchive", sessionId: session.memorySessionId || "" }, { session });
  renderChatSessionSelect();
  updateContextUsage();
  schedulePersistChatSessions();
  if (closePopover) closeChatHistoryPopover();
  chatInput.focus();
  return true;
}

export function maybeNameActiveChat(text) {
  const session = activeChatSession();
  if (!session || session.history.length > 1) return;
  const clean = fileTagDisplayText(text).replace(/\s+/g, " ").trim();
  if (!clean) return;
  session.title = clean.length > 28 ? `${clean.slice(0, 27)}...` : clean;
  renderChatSessionSelect();
}
