import { appState } from "../../core/app-state.js";
import { messages, chatHistorySecurityWarning } from "../../core/dom-refs.js";
import {
  isBareToolVerbLabel, decorateBareToolLabel, renderToolStatusLabelFromText, canonicalChatMode,
  normalizeContextUsageSnapshot, chatSessions, closedChatSessions, archivedChatSessions,
  setAgentStatus, activeChatSession, syncActiveChatSession,
} from "../../bootstrap.js";
import {
  activeChatRuns, isChatSessionRunning, isRunningChatActive, syncChatRunSession,
} from "./chat-run-state.js";
import { hasWorkNode, unwrapWorkFold, workFoldBody } from "./chat-work-fold.js";
import { normalizeUiTranscript } from "./chat-transcript.js";
import { normalizeLiveInputs } from "./live-input.js";
import { MessageIdentity } from "../../core/runtime-globals.js";

export function paintLiveInputRecord(session, record) {
  const host = activeChatRuns.get(session.id)?.viewHost || (appState.activeChatSessionId === session.id ? messages : null);
  const turn = [...(host?.querySelectorAll(".chat-turn.user") || [])].find((node) => node.dataset.sourceMessageId === record.id);
  turn?.querySelector(".chat-input-status")?.remove();
  if (turn && record.taskId) turn.dataset.taskId = record.taskId;
  const message = session.history?.find((item) => item?.id === record.id || item?.source_message_id === record.id);
  if (message && record.taskId) message.task_id = record.taskId;
}

export const queueMigrationInFlight = new Set();

export const chatPersistenceTimers = new Map();

export function createChatSession(title = "New Agent") {
  const id = `chat-${Date.now()}-${++appState.chatSessionCounter}`;
  const now = new Date().toISOString();
  return {
    id,
    memoryProjectId: "",
    memorySessionId: "",
    memoryBlockId: "",
    memoryBlockHistoryStart: -1,
    title,
    history: [],
    contextFilesCache: [],
    createdAt: now,
    updatedAt: now,
    memory: {
      version: 3,
      checkpointId: null,
      checkpointRevision: 0,
      checkpointTokens: 0,
      status: "empty",
      updatedAt: null,
      warning: "",
    },
    lastContextUsage: null,
    currentWorkflow: null,
    messagesHtml: "",
    transcript: { version: 1, runs: [] },
    activeStreamContent: "",
    chatMode: appState.chatMode,
    chatFamily: appState.chatFamily,
    selectedModel: appState.selectedModel,
    draftText: "",
    draftSlashCommand: "",
  };
}

export function memoryRecord(session) {
  if (!session) return null;
  if (!session.memory || typeof session.memory !== "object") {
    session.memory = {
      version: 3,
      checkpointId: null,
      checkpointRevision: 0,
      checkpointTokens: 0,
      status: "empty",
      updatedAt: null,
      warning: "",
    };
  }
  session.memory.version = 3;
  if (!Number.isFinite(Number(session.memory.checkpointTokens))) session.memory.checkpointTokens = 0;
  return session.memory;
}

export function applyCheckpointToSession(session, payload = {}) {
  if (!session) return;
  const memory = memoryRecord(session);
  const status = String(payload.status || "").toLowerCase();
  if (status === "completed") {
    memory.status = "ready";
    memory.checkpointId = String(payload.checkpointId || payload.checkpointRevision || memory.checkpointId || "") || null;
    memory.updatedAt = new Date().toISOString();
    const summarized = Number(payload.summarizedConversationTokens);
    if (Number.isFinite(summarized) && summarized >= 0) memory.checkpointTokens = summarized;
    if (payload.currentWorkflow && typeof payload.currentWorkflow === "object") {
      session.currentWorkflow = payload.currentWorkflow;
    }
  } else if (status === "failed") {
    memory.status = "error";
    memory.warning = String(payload.code || "Checkpoint failed");
  }
}

export function clearChatSessionState(session) {
  if (!session) return;
  session.history = [];
  session.contextFilesCache = [];
  session.memory = {
    version: 3,
    checkpointId: null,
    checkpointRevision: 0,
    status: "empty",
    updatedAt: null,
    warning: "",
  };
  session.lastContextUsage = null;
  session.messagesHtml = "";
  session.transcript = { version: 1, runs: [] };
  session.activeStreamContent = "";
  session.draftText = "";
  session.draftSlashCommand = "";
  session.memoryProjectId = "";
  session.memorySessionId = "";
  session.memoryBlockId = "";
  session.memoryBlockHistoryStart = -1;
}

export function currentChatPersistenceScope() {
  return appState.assessmentPath || appState.rootPath || "";
}

export function redactThinkingDisclosures(root) {
  root?.querySelectorAll?.(".thinking-body").forEach((body) => {
    const active = body.closest(".thinking-block")?.classList.contains("is-thinking");
    body.textContent = active
      ? "Reasoning is running privately. Raw chain-of-thought and system instructions stay hidden."
      : "Reasoning completed privately. Raw chain-of-thought and system instructions were not displayed.";
    body.removeAttribute("data-raw-md");
  });
}

export function isPlaceholderToolCardLabel(label = "") {
  return /^(Working|Queued)(?:\.{0,3}|\u2026)?$/i.test(String(label || "").trim());
}

export function isTransientToolCardLabel(label = "") {
  return /^(Completed|Done|Failed)\.?$/i.test(String(label || "").trim());
}

export function isStubToolStatusLabel(label = "") {
  return /^(Working|Queued|Completed|Done)(?:\.{0,3}|\u2026)?$/i.test(String(label || "").trim());
}

export const KEEPABLE_TOOL_LABEL = /^(Reading page|Read page|Searching workspace|Searched workspace|Searching web|Searched web|Creating folder|Created folder|Updating identity|Updated identity|Running Command|Ran Command|Viewing terminal|Viewed terminal|Reading|Read|Editing|Edited|Searching|Searched|Deleting|Deleted|Creating|Created|Moving|Moved|Browsing|Browsed|Replaying|Replayed|Delegating|Delegated)\b/i;

export const KEEPABLE_TOOL_ACTIONS = new Set([
  "read_file",
  "apply_patch",
  "exec_command",
  "view_active_terminal",
  "search_workspace",
  "web_research",
  "browser_action",
  "replay_request",
  "manage_identity",
  "delegate_agent",
  "create_guidance",
]);

export const RUNNING_TOOL_VERBS = [
  ["Running Command", "Ran Command"],
  ["Viewing terminal", "Viewed terminal"],
  ["Updating identity", "Updated identity"],
  ["Creating folder", "Created folder"],
  ["Searching workspace", "Searched workspace"],
  ["Searching web", "Searched web"],
  ["Reading page", "Read page"],
  ["Delegating", "Delegated"],
  ["Replaying", "Replayed"],
  ["Browsing", "Browsed"],
  ["Searching", "Searched"],
  ["Reading", "Read"],
  ["Deleting", "Deleted"],
  ["Editing", "Edited"],
  ["Creating", "Created"],
  ["Moving", "Moved"],
];

export function completedToolLabelFromRunning(runningLabel = "") {
  const value = String(runningLabel || "").trim();
  for (const [from, to] of RUNNING_TOOL_VERBS) {
    if (value === from || value.startsWith(`${from} `)) return `${to}${value.slice(from.length)}`;
  }
  return "";
}

export function toolCardLabelText(card) {
  return String(card?.querySelector?.(".tool-card-file")?.textContent || card?.dataset?.runningLabel || "").trim();
}

export function keepableToolCardLabel(label = "") {
  const value = String(label || "").trim();
  return KEEPABLE_TOOL_LABEL.test(value) && !isBareToolVerbLabel(value) && !isStubToolStatusLabel(value);
}

export function isKeepableToolCard(card) {
  if (!card) return false;
  const text = decorateBareToolLabel(card, toolCardLabelText(card));
  if (keepableToolCardLabel(text)
    || keepableToolCardLabel(decorateBareToolLabel(card, card.dataset?.runningLabel))
    || keepableToolCardLabel(decorateBareToolLabel(card, card.dataset?.completedLabel))) {
    return true;
  }
  if (isTransientToolCardLabel(text) || isPlaceholderToolCardLabel(text) || isBareToolVerbLabel(text)) return false;
  if (card.dataset?.fileActionKind || card.classList?.contains("file-action")) return true;
  const action = String(card.dataset?.toolAction || "");
  return KEEPABLE_TOOL_ACTIONS.has(action);
}

export function syncToolCardPlaceholderVisibility(card) {
  if (!card) return card;
  const text = toolCardLabelText(card);
  const resolved = decorateBareToolLabel(card, text);
  if (keepableToolCardLabel(resolved)) {
    if (resolved !== text) {
      const fileEl = card.querySelector(".tool-card-file");
      if (fileEl) renderToolStatusLabelFromText(fileEl, resolved);
    }
    card.hidden = false;
    return card;
  }
  if (isStubToolStatusLabel(text) || isTransientToolCardLabel(text) || isBareToolVerbLabel(text) || !String(text || "").trim()) {
    const recovered = [card.dataset?.completedLabel, card.dataset?.runningLabel]
      .map((value) => decorateBareToolLabel(card, value))
      .find((value) => keepableToolCardLabel(value));
    if (recovered) {
      const fileEl = card.querySelector(".tool-card-file");
      if (fileEl) renderToolStatusLabelFromText(fileEl, recovered);
      card.hidden = false;
      return card;
    }
    card.hidden = true;
    return card;
  }
  card.hidden = false;
  return card;
}

export function stripFailedToolCardStubs(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll(".tool-card[data-state='error']").forEach((node) => node.remove());
  root.querySelectorAll(".tool-card").forEach((node) => {
    const text = toolCardLabelText(node);
    if (keepableToolCardLabel(decorateBareToolLabel(node, text))) return;
    const recovered = [node.dataset?.completedLabel, node.dataset?.runningLabel]
      .map((value) => decorateBareToolLabel(node, value))
      .find((value) => keepableToolCardLabel(value));
    if (recovered) {
      const fileEl = node.querySelector(".tool-card-file");
      if (fileEl) renderToolStatusLabelFromText(fileEl, recovered);
      node.hidden = false;
      return;
    }
    if (isStubToolStatusLabel(text) || isTransientToolCardLabel(text) || isBareToolVerbLabel(text) || !String(text || "").trim()) {
      node.remove();
    }
  });
}

// A run that produced no tool work has nothing to fold, so its replies go back
// to the turn rather than hiding behind a header that summarises nothing.
export function pruneEmptyWorkFolds(root) {
  if (!root?.querySelectorAll) return;
  for (const fold of [...root.querySelectorAll(".agent-work-fold")]) {
    if (!hasWorkNode(workFoldBody(fold))) unwrapWorkFold(fold);
  }
}

export function sanitizePersistedChatHtml(html) {
  const raw = String(html || "");
  const clean = globalThis.DOMPurify
    ? globalThis.DOMPurify.sanitize(raw, {
      ADD_TAGS: ["button", "img"],
       ADD_ATTR: ["class", "src", "alt", "width", "height", "data-code", "data-mermaid-source", "data-raw-md", "data-task-step", "data-task-status", "data-task-target", "data-chat-starter", "data-child-invocation-id", "data-child-session-id", "data-parent-session-id", "data-model", "data-state", "data-state-key", "data-final", "data-used-tools", "data-expanded", "data-file", "data-file-action-kind", "data-file-verb", "data-tool-action", "data-tool-key", "data-call-id", "data-running-label", "data-completed-label", "data-work-verdict", "data-answered", "data-sealed", "data-started-at", "data-ended-at", "data-duration-ms", "data-worked-for-ms", "data-command-text", "data-command-context", "data-cwd", "data-exit-code", "data-stdout", "data-lane", "data-path", "data-verb", "data-foldable", "data-open-project-settings", "title", "type", "role", "tabindex", "hidden", "aria-hidden", "aria-expanded", "aria-current", "aria-label"],
    })
    : "";
  const template = document.createElement("template");
  template.innerHTML = clean;
  template.content.querySelectorAll(".stream-cursor").forEach((node) => node.remove());
  template.content.querySelectorAll(".streaming").forEach((node) => node.classList.remove("streaming"));
  template.content.querySelectorAll("[data-live-reply]").forEach((node) => node.removeAttribute("data-live-reply"));
  // Old chat snapshots may contain XEKUTE's former hypothesis/working line.
  template.content.querySelectorAll(".assistant-status").forEach((node) => node.remove());
  // Progress checklists were redundant with the durable tool and command rows.
  // Strip them from older snapshots as well as preventing new ones below.
  template.content.querySelectorAll(".agent-progress-feed").forEach((node) => node.remove());
  template.content.querySelectorAll(".harness-wait-line").forEach((node) => node.remove());
  template.content.querySelectorAll(".agent-status-icon").forEach((node) => node.remove());
  template.content.querySelectorAll(".context-checkpoint-icon").forEach((node) => node.remove());
  template.content.querySelectorAll(".agent-status-line:not([data-final='true'])").forEach((node) => node.remove());
  template.content.querySelectorAll(".agent-status-line").forEach((node) => {
    const text = String(node.querySelector(".agent-status-text")?.textContent || "").trim();
    if (/^Stopped after /i.test(text) || /^(Failed|Action failed)\.?$/i.test(text)) node.remove();
  });
  stripFailedToolCardStubs(template.content);
  pruneEmptyWorkFolds(template.content);
  template.content.querySelectorAll(".chat-turn.error").forEach((node) => node.remove());
  template.content.querySelectorAll(".context-checkpoint-notice").forEach((node) => {
    const state = String(node.getAttribute("data-state") || "").toLowerCase();
    if (state === "complete" || state === "error") return;
    node.remove();
  });
  redactThinkingDisclosures(template.content);
  return template.innerHTML;
}

export function normalizePersistedChatSession(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id.trim()) return null;
  const sourceMessages = Array.isArray(value.messages) ? value.messages : value.history;
  const history = Array.isArray(sourceMessages)
    ? MessageIdentity.ensureMessageIdentity(sourceMessages
      .filter((message) => message && typeof message === "object" && typeof message.role === "string")
      .map(({ thinking: _privateReasoning, ...message }) => message), value.id)
    : [];
  const storedFamily = value.safetyFamily || value.chatFamily;
  const family = "xekute";
  void storedFamily;
  const storedMemory = value.memory && typeof value.memory === "object" ? value.memory : null;
  const memory = {
    version: 3,
    checkpointId: String(storedMemory?.checkpointId || "") || null,
    checkpointRevision: Math.max(0, Number(storedMemory?.checkpointRevision) || 0),
    checkpointTokens: Math.max(0, Number(storedMemory?.checkpointTokens) || 0),
    status: ["empty", "ready", "error"].includes(String(storedMemory?.status || ""))
      ? String(storedMemory?.status)
      : "empty",
    updatedAt: storedMemory?.updatedAt || null,
    warning: String(storedMemory?.warning || ""),
  };
  return {
    id: value.id.slice(0, 200),
    memoryProjectId: String(value.memoryProjectId || value.projectId || "").slice(0, 240),
    memorySessionId: String(value.memorySessionId || value.id || "").slice(0, 240),
    memoryBlockId: String(value.memoryBlockId || value.lastBlockId || "").slice(0, 240),
    memoryBlockHistoryStart: -1,
    title: String(value.title || "New Agent").slice(0, 120),
    history,
    contextFilesCache: [],
    memory,
    lastContextUsage: normalizeContextUsageSnapshot(value.lastContextUsage),
    currentWorkflow: value.currentWorkflow && typeof value.currentWorkflow === "object" ? value.currentWorkflow : null,
    messagesHtml: sanitizePersistedChatHtml(value.messagesHtml),
    transcript: normalizeUiTranscript(value.transcript || value.ui_transcript || value.uiTranscript),
    activeStreamContent: "",
    chatFamily: family,
    chatMode: canonicalChatMode(value.mode || value.chatMode),
    selectedModel: typeof (value.model || value.selectedModel) === "string" ? (value.model || value.selectedModel) : "",
    kind: String(value.kind || "chat").slice(0, 40),
    orchestratorPrompt: String(value.orchestratorPrompt || "").slice(0, 12_000),
    parentSessionId: String(value.parentSessionId || "").slice(0, 240),
    childInvocationId: String(value.childInvocationId || "").slice(0, 240),
    forkedFromSessionId: String(value.forkedFromSessionId || "").slice(0, 240),
    taskId: String(value.taskId || ""),
    parentMemorySessionId: String(value.parentMemorySessionId || value.parentSessionId || ""),
    sourceMessageIds: Array.isArray(value.sourceMessageIds) ? value.sourceMessageIds.map(String) : [],
    liveInputs: normalizeLiveInputs(value.liveInputs),
    ...(value.promptQueue && typeof value.promptQueue === "object" ? { promptQueue: structuredClone(value.promptQueue) } : {}),
    draftText: String(value.draftText || ""),
    draftSlashCommand: "",
    createdAt: value.createdAt || value.created_at || null,
    updatedAt: value.updatedAt || value.updated_at || value.createdAt || value.created_at || null,
    status: ["complete", "stopped", "interrupted"].includes(value.status) ? value.status : "complete",
  };
}

export function serializeChatSession(session) {
  return {
    id: session.id,
    title: session.title,
    memory: memoryRecord(session),
    lastContextUsage: session.lastContextUsage,
    currentWorkflow: session.currentWorkflow || null,
    mode: session.chatMode || appState.chatMode,
    safetyFamily: session.chatFamily || appState.chatFamily,
    model: session.selectedModel || appState.selectedModel,
    kind: session.kind || "chat",
    orchestratorPrompt: String(session.orchestratorPrompt || "").slice(0, 12_000),
    parentSessionId: session.parentSessionId || "",
    childInvocationId: session.childInvocationId || "",
    forkedFromSessionId: session.forkedFromSessionId || "",
    taskId: session.taskId || "",
    parentMemorySessionId: session.parentMemorySessionId || "",
    sourceMessageIds: session.sourceMessageIds || [],
    liveInputs: normalizeLiveInputs(session.liveInputs),
    draftText: session.draftText || "",
    ...(session.promptQueue ? { promptQueue: session.promptQueue } : {}),
    createdAt: session.createdAt || null,
    updatedAt: session.updatedAt || null,
    status: isChatSessionRunning(session.id) ? "interrupted" : "complete",
    messagesHtml: session.messagesHtml || "",
    transcript: normalizeUiTranscript(session.transcript),
  };
}

export function chatPersistenceState() {
  return {
    activeSessionId: appState.activeChatSessionId,
    sessions: chatSessions.map(serializeChatSession),
    closedSessions: closedChatSessions.map(serializeChatSession),
    archivedSessions: archivedChatSessions.map(serializeChatSession),
  };
}

export function reportChatHistoryWarning(error) {
  appState.chatHistoryWarning = String(error?.message || error || "Chat history could not be saved.");
  console.warn("Could not save chat history:", appState.chatHistoryWarning);
  if (chatHistorySecurityWarning) {
    chatHistorySecurityWarning.textContent = appState.chatHistoryWarning;
    chatHistorySecurityWarning.hidden = false;
  }
  if (!isRunningChatActive()) setAgentStatus("Chat save delayed");
}

export function reportChatHistoryDurability(result) {
  if (result?.durable !== false && result?.encrypted !== false) {
    appState.chatHistoryWarning = "";
    if (chatHistorySecurityWarning) {
      chatHistorySecurityWarning.textContent = "";
      chatHistorySecurityWarning.hidden = true;
    }
    return false;
  }
  appState.chatHistoryWarning = "Secure storage is unavailable; chat history will remain only until this process exits.";
  console.warn("Chat history is process-only:", appState.chatHistoryWarning);
  if (chatHistorySecurityWarning) {
    chatHistorySecurityWarning.textContent = appState.chatHistoryWarning;
    chatHistorySecurityWarning.hidden = false;
  }
  if (!isRunningChatActive()) setAgentStatus("Chat history not durable");
  return true;
}

export function activeChatHistoryContext(session = activeChatSession()) {
  if (!session?.memorySessionId || !appState.rootPath) return null;
  return {
    workspace: appState.rootPath,
    projectId: session.memoryProjectId || "",
    sessionId: session.memorySessionId,
    blockId: session.memoryBlockId || "",
  };
}

export function chatHistoryMeta(session) {
  if (!session) return {};
  return {
    title: session.title,
    model: session.selectedModel || appState.selectedModel,
    mode: session.chatMode || appState.chatMode,
    family: session.chatFamily || appState.chatFamily,
    memory: memoryRecord(session),
    lastContextUsage: session.lastContextUsage,
    currentWorkflow: session.currentWorkflow || null,
    status: archivedChatSessions.includes(session)
      ? "archived"
      : closedChatSessions.includes(session)
        ? "closed"
        : (isChatSessionRunning(session.id) ? "running" : "active"),
  };
}

export function activeChatHistoryTranscript(session) {
  if (!session) return [];
  const history = Array.isArray(session.history) ? session.history : [];
  const start = Number.isInteger(session.memoryBlockHistoryStart) && session.memoryBlockHistoryStart >= 0
    ? session.memoryBlockHistoryStart
    : Math.max(0, history.map((message) => message?.role).lastIndexOf("user"));
  return history.slice(start).filter((message) => message && typeof message === "object");
}

export function queueChatHistoryEvent(event = {}, { session = activeChatSession(), immediate = true } = {}) {
  const context = activeChatHistoryContext(session);
  if (!context || !window.api.recordChatEvent) return Promise.resolve({ ok: true, skipped: true });
  const payload = {
    workspace: context.workspace,
    projectId: context.projectId,
    sessionId: context.sessionId,
    blockId: event.blockId || context.blockId,
    ...event,
  };
  appState.chatHistoryWriteQueue = appState.chatHistoryWriteQueue
    .catch(() => {})
    .then(() => window.api.recordChatEvent(payload))
    .then((result) => {
      if (result?.error || result?.ok === false) throw new Error(result.error?.message || result.error || "Chat history save failed.");
      reportChatHistoryDurability(result);
      return result;
    })
    .catch((error) => {
      reportChatHistoryWarning(error);
      return { ok: false, error: appState.chatHistoryWarning };
    });
  if (immediate) return appState.chatHistoryWriteQueue;
  return Promise.resolve({ ok: true, queued: true });
}

export function persistChatHistorySnapshot(scope = appState.activeChatPersistenceScope, session = activeChatSession()) {
  if (!scope || !session?.memorySessionId || !session.memoryBlockId) return Promise.resolve({ ok: true, skipped: true });
  return queueChatHistoryEvent({
    type: "snapshot",
    session: chatHistoryMeta(session),
    transcript: activeChatHistoryTranscript(session),
    displayHtml: session.messagesHtml || "",
    uiTranscript: normalizeUiTranscript(session.transcript),
    blockId: session.memoryBlockId,
    outcome: isChatSessionRunning(session.id) ? "pending" : undefined,
  }, { session });
}

export function beginChatHistoryBlock(text, session = activeChatSession()) {
  if (!session || !appState.rootPath || !String(text || "").trim() || !window.api.beginChatBlock) return Promise.resolve(null);
  const history = Array.isArray(session.history) ? session.history : [];
  const message = history.at(-1);
  return window.api.beginChatBlock({
    workspace: appState.rootPath,
    sessionId: session.memorySessionId || "",
    title: session.title,
    userPrompt: text,
    userMessageId: message?.id || "",
    session: chatHistoryMeta(session),
  }).then((result) => {
    if (!result?.ok || result?.error) throw new Error(result?.error?.message || result?.error || "Chat history could not start.");
    session.memoryProjectId = result.projectId || session.memoryProjectId || "";
    session.memorySessionId = result.sessionId || session.memorySessionId || "";
    session.memoryBlockId = result.blockId || "";
    session.memoryBlockHistoryStart = Math.max(0, history.length - 1);
    reportChatHistoryDurability(result);
    return result;
  }).catch((error) => {
    reportChatHistoryWarning(error);
    return null;
  });
}

export function finishChatHistoryBlock({ session = activeChatSession(), assistant = null, outcome = "completed" } = {}) {
  const context = activeChatHistoryContext(session);
  if (!context) return Promise.resolve({ ok: true, skipped: true });
  const content = String(assistant?.rawContent || assistant?.displayContent?.() || "").trim();
  const start = Number.isInteger(session.memoryBlockHistoryStart) && session.memoryBlockHistoryStart >= 0
    ? session.memoryBlockHistoryStart
    : 0;
  const history = Array.isArray(session.history) ? session.history : [];
  const assistantMessage = history.slice(start).reverse().find((message) => message?.role === "assistant");
  const messageId = assistant?.messageId || assistantMessage?.id || `${session.id}-assistant-${Date.now()}`;
  const event = {
    type: "outcome",
    session: chatHistoryMeta(session),
    blockId: context.blockId,
    messageId,
    text: content,
    outcome,
    transcript: activeChatHistoryTranscript(session),
    displayHtml: session.messagesHtml || "",
    uiTranscript: normalizeUiTranscript(session.transcript),
  };
  const persisted = queueChatHistoryEvent(event, { session });
  return persisted;
}

export function clearScheduledChatPersistence() {
  for (const timer of chatPersistenceTimers.values()) clearTimeout(timer);
  chatPersistenceTimers.clear();
}

export const liveChatSnapshotTimers = new Map();
export const LIVE_CHAT_SNAPSHOT_MS = 1200;

export function cancelLiveChatSnapshot(run) {
  const key = String(run?.session?.id || run?.sessionId || "");
  const timer = liveChatSnapshotTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  liveChatSnapshotTimers.delete(key);
}

export function scheduleLiveChatSnapshot(run) {
  if (!run?.session) return;
  const key = String(run.session.id || run.sessionId || "");
  if (!key || liveChatSnapshotTimers.has(key)) return;
  const timer = setTimeout(() => {
    liveChatSnapshotTimers.delete(key);
    syncChatRunSession(run);
  }, LIVE_CHAT_SNAPSHOT_MS);
  liveChatSnapshotTimers.set(key, timer);
}

export function schedulePersistChatSessions(session = activeChatSession()) {
  if (!appState.activeChatPersistenceScope || !session) return;
  const scope = appState.activeChatPersistenceScope;
  const key = String(session.id || session.memorySessionId || "active");
  if (chatPersistenceTimers.has(key)) return;
  const timer = setTimeout(() => {
    chatPersistenceTimers.delete(key);
    persistChatHistorySnapshot(scope, session);
  }, 120);
  chatPersistenceTimers.set(key, timer);
}

export function flushChatSessionsBeforeClose() {
  if (!appState.activeChatPersistenceScope || !window.api.saveChatHistoryBeforeClose) return;
  clearScheduledChatPersistence();
  for (const run of activeChatRuns.values()) syncChatRunSession(run, { persist: false });
  syncActiveChatSession({ persist: false });
  const targets = [...new Map(
    [activeChatSession(), ...[...activeChatRuns.values()].map((run) => run.session)]
      .filter(Boolean)
      .map((session) => [session.id, session]),
  ).values()];
  for (const session of targets) {
    const context = activeChatHistoryContext(session);
    if (!context) continue;
    try {
      window.api.saveChatHistoryBeforeClose({
        workspace: context.workspace,
        projectId: context.projectId,
        sessionId: context.sessionId,
        blockId: context.blockId,
        type: "snapshot",
        session: chatHistoryMeta(session),
        transcript: activeChatHistoryTranscript(session),
        displayHtml: session.messagesHtml || "",
        uiTranscript: normalizeUiTranscript(session.transcript),
        outcome: isChatSessionRunning(session.id) ? "stopped" : undefined,
      });
    } catch (error) {
      reportChatHistoryWarning(error);
    }
  }
}
