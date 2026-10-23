import { appState } from "../../core/app-state.js";
import { messages, chatInput } from "../../core/dom-refs.js";
import { drainPendingBackgroundWaitEvents } from "../agents/background-waits.js";
import { ensureParentContinuationRun } from "../agents/parent-continuation.js";
import { chatSessionIdForRuntimeId } from "../agents/delegated-child-runs.js";
import {
  subagentCardBlocksParent, syncSubagentOrchestrationWaitStatus,
} from "../agents/subagent-cards.js";
import { updateSendBtn } from "./composer-input.js";
import { coalesceDelegatedAssistantReplyFragments } from "./assistant-turn.js";
import {
  commandCompletionForRow, updateCommandTimelineRow, stopCommandTimelineTicker,
} from "./command-timeline.js";
import { setAgentStatus } from "./chat-messages.js";
import { hydrateContextCheckpointNotices } from "./context-checkpoints.js";
import { modeLabel } from "./chat-mode.js";
import { renderChatSessionSelect, activeChatSession } from "./chat-sessions.js";
import {
  sanitizePersistedChatHtml, redactThinkingDisclosures, stripFailedToolCardStubs,
  schedulePersistChatSessions, cancelLiveChatSnapshot,
} from "./chat-persistence.js";
import {
  captureSessionTranscript, markSteeringAnswer, hydrateSubagentRunCards,
} from "./transcript-replay.js";
import {
  normalizeAssistantTurns, hydrateExploredFoldLabels, hydrateThinkingFolds,
} from "./turn-structure.js";
import { MessageIdentity } from "../../core/runtime-globals.js";
import { captureChatSnapshot } from "./chat-transcript.js";

export const activeChatRuns = new Map();

export function isChatSessionRunning(sessionId) {
  const run = activeChatRuns.get(String(sessionId || ""));
  if (!run || run.stopRequested) return false;
  if (run.orchestrationHold || run.commandWait) return true;
  if (run.awaitingParentContinuation || run.pendingEndTurn) return true;
  if (rootHasLiveProcesses(runWorkRoot(run))) return true;
  return run.state === "running";
}

export function runWorkRoot(run) {
  if (!run) return null;
  if (run.viewHost) return run.viewHost;
  const turns = run.assistant?.assistantTurns?.() || [];
  if (turns.length) return turns[0].closest(".chat-exchange") || turns[0].parentElement || turns[0];
  if (appState.activeChatSessionId === run.sessionId) return messages;
  return null;
}

export function rootHasLiveProcesses(root) {
  if (!root?.querySelector) return false;
  if ([...root.querySelectorAll(".subagent-run-card")].some(subagentCardBlocksParent)) return true;
  if (root.querySelector(".agent-command-event[data-waiting='true']")) return true;
  if (root.querySelector(".tool-card.subagent-wait, .tool-card[data-state='waiting']")) return true;
  return false;
}

export function parentRunStillWorking(run) {
  if (!run || run.stopRequested) return false;
  if (run.modelTurnOpen || run.orchestrationHold || run.commandWait || run.pendingEndTurn || run.awaitingParentContinuation) return true;
  return rootHasLiveProcesses(runWorkRoot(run));
}

export function settleVisibleParentRun(run) {
  if (!run || run.visibleSettled || run.stopRequested || parentRunStillWorking(run)) return;
  run.visibleSettled = true;
  run.modelTurnOpen = false;
  run.awaitingParentContinuation = false;
  run.state = "complete";
  run.activeStreamContent = "";
  run.assistant?.finishLiveState?.(run.assistant.finalOutcome || "complete");
  for (const turn of run.assistant?.assistantTurns?.() || [run.assistant?.turn]) {
    turn?.setAttribute("aria-busy", "false");
  }
  syncSubagentOrchestrationWaitStatus(run);
  if (activeChatRuns.get(run.sessionId) === run) activeChatRuns.delete(run.sessionId);
  updateSendBtn();
  renderChatSessionSelect();
  if (appState.activeChatSessionId === run.sessionId) {
    appState.activeStreamContent = "";
    setAgentStatus(`${modeLabel()} ready`);
    if (!appState.contextCheckpointing) {
      chatInput.disabled = false;
      chatInput.readOnly = false;
      chatInput.removeAttribute("aria-disabled");
    }
  }
}

export function keepParentRunOpen(run, { continuation = false } = {}) {
  if (!run || run.stopRequested) return;
  run.visibleSettled = false;
  run.state = "running";
  if (continuation) run.awaitingParentContinuation = true;
  run.orchestrationHold = true;
  activeChatRuns.set(run.sessionId, run);
  for (const turn of run.assistant?.assistantTurns?.() || [run.assistant?.turn]) {
    turn?.setAttribute("aria-busy", "true");
  }
  run.assistant?.turn?.closest?.(".chat-exchange")?.querySelectorAll(".assistant-reply-footer").forEach((node) => node.remove());
  syncSubagentOrchestrationWaitStatus(run);
  updateSendBtn();
  if (appState.activeChatSessionId === run.sessionId) setAgentStatus(`${modeLabel()} orchestrating…`);
}

export function noteParentContinuationStarted(payload = {}) {
  const sessionId = chatSessionIdForRuntimeId(payload.parentSessionId || payload.sessionId || "");
  const run = activeChatRuns.get(sessionId) || ensureParentContinuationRun(payload);
  if (!run) return;
  keepParentRunOpen(run, { continuation: true });
}

export function noteParentRunSettled(payload = {}) {
  const sessionId = chatSessionIdForRuntimeId(payload.parentSessionId || payload.sessionId || "");
  const run = activeChatRuns.get(sessionId);
  if (!run || run.stopRequested) return;
  run.awaitingParentContinuation = false;
  run.orchestrationHold = Boolean(payload.orchestrationHold);
  run.pendingEndTurn = Boolean(payload.pendingEndTurn);
  if (Object.hasOwn(payload, "commandWait")) run.commandWait = Boolean(payload.commandWait);
  if (parentRunStillWorking(run)) {
    run.state = "running";
    activeChatRuns.set(run.sessionId, run);
    syncSubagentOrchestrationWaitStatus(run);
    updateSendBtn();
    if (appState.activeChatSessionId === run.sessionId) setAgentStatus(`${modeLabel()} orchestrating…`);
    return;
  }
  settleVisibleParentRun(run);
  queueMicrotask(drainPendingBackgroundWaitEvents);
}

export function isRunningChatActive() {
  return isChatSessionRunning(appState.activeChatSessionId);
}

export function activeSessionRun() {
  return activeChatRuns.get(String(appState.activeChatSessionId || "")) || null;
}

export function anyChatSessionRunning() {
  return [...activeChatRuns.values()].some((run) => run?.state === "running");
}

export function chatRunContainer(run = activeSessionRun()) {
  if (!run) return messages;
  if (run.viewHost) return run.viewHost;
  if (appState.activeChatSessionId === run.sessionId) return messages;
  const host = document.createElement("div");
  host.innerHTML = sanitizePersistedChatHtml(run.session?.messagesHtml || "");
  run.viewHost = host;
  return host;
}

export function stashActiveChatRunView(session = activeChatSession()) {
  const run = session ? activeChatRuns.get(session.id) : null;
  if (!session || !run || run.state !== "running" || run.viewHost || !messages) return;
  const host = document.createElement("div");
  while (messages.firstChild) host.appendChild(messages.firstChild);
  run.viewHost = host;
  session.messagesHtml = sanitizePersistedChatHtml(host.innerHTML);
  captureSessionTranscript(session, host);
}

export function hydratePersistedChatTranscript(root = messages) {
  if (!root) return;
  root.querySelectorAll?.(".chat-turn.error").forEach((node) => node.remove());
  // A restored snapshot is never live, even if it was captured mid-run.
  root.querySelectorAll?.(".chat-turn.assistant[aria-busy='true']").forEach((turn) => turn.setAttribute("aria-busy", "false"));
  stripFailedToolCardStubs(root);
  normalizeAssistantTurns(root);
  (root.classList?.contains("chat-exchange") ? [root] : [...(root.querySelectorAll?.(".chat-exchange") || [])]).forEach(markSteeringAnswer);
  redactThinkingDisclosures(root);
  hydrateSubagentRunCards(root);
  hydrateContextCheckpointNotices(root);
  hydrateExploredFoldLabels(root);
  hydrateThinkingFolds(root);
  for (const row of root.querySelectorAll?.(".agent-command-event") || []) {
    stopCommandTimelineTicker(row);
    if (row.dataset.state === "running" && row.dataset.waiting === "true") {
      const completion = commandCompletionForRow(row);
      if (completion) updateCommandTimelineRow(row, completion.state);
    }
  }
}

export function syncAssistantDraftToHistory(run, assistant = run?.assistant, { persist = true } = {}) {
  const session = run?.session;
  const content = String(assistant?.rawContent || "");
  if (!session || !assistant || run?.assistantDraftFinalized || !content.trim()) return null;
  const history = Array.isArray(run.history) ? run.history : [];
  let message = assistant.messageId
    ? history.find((item) => item?.id === assistant.messageId)
    : null;
  if (!message) {
    const id = `${session.id}-assistant-stream-${Date.now()}`;
    message = {
      role: "assistant",
      content,
      id,
      createdAt: assistant.turn?.dataset?.createdAt || new Date().toISOString(),
    };
    history.push(message);
    assistant.messageId = id;
    run.assistantDraftMessageId = id;
  } else {
    message.content = content;
    message.createdAt = message.createdAt || assistant.turn?.dataset?.createdAt || new Date().toISOString();
  }
  run.history = history;
  session.history = history;
  if (appState.activeChatSessionId === session.id) appState.chatHistory = history;
  if (persist) schedulePersistChatSessions(session);
  return message;
}

export function discardAssistantDraft(run, assistant = run?.assistant) {
  const history = Array.isArray(run?.history) ? run.history : [];
  if (!assistant?.messageId) {
    if (run) run.assistantDraftFinalized = true;
    return false;
  }
  const index = history.findIndex((message) => message?.id === assistant.messageId && message?.id === run?.assistantDraftMessageId);
  if (index < 0) {
    if (run) run.assistantDraftFinalized = true;
    return false;
  }
  history.splice(index, 1);
  assistant.messageId = "";
  run.assistantDraftMessageId = "";
  run.assistantDraftFinalized = true;
  return true;
}

export function syncChatRunSession(run = activeSessionRun(), { persist = true } = {}) {
  cancelLiveChatSnapshot(run);
  const session = run?.session;
  if (!session) return;
  syncAssistantDraftToHistory(run, run.assistant, { persist: false });
  session.history = MessageIdentity?.ensureMessageIdentity
    ? MessageIdentity.ensureMessageIdentity(run.history, session.id)
    : run.history;
  run.history = session.history;
  const assistant = run.assistant;
  if (assistant?.turn) {
    if (run.delegated) coalesceDelegatedAssistantReplyFragments(assistant);
    const rows = [...assistant.turn.querySelectorAll(".subagent-run-card")].map((card) => ({
      childInvocationId: String(card.dataset.childInvocationId || ""),
      childSessionId: String(card.dataset.childSessionId || ""),
      parentSessionId: String(card.dataset.parentSessionId || session.id || ""),
      independent: card.dataset.independent === "true",
      taskId: String(card.dataset.taskId || ""),
      model: String(card.dataset.model || ""),
      status: String(card.dataset.state || "working"),
      summary: String(card.querySelector(".subagent-run-detail")?.textContent || "").slice(0, 240),
    })).filter((row) => row.childInvocationId || row.childSessionId);
    if (rows.length) {
      let assistantMessage = [...session.history].reverse().find((message) => message?.role === "assistant");
      if (!assistantMessage) {
        assistantMessage = {
          role: "assistant",
          content: String(assistant.rawContent || ""),
          id: `${session.id}-assistant-${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        session.history.push(assistantMessage);
      }
      assistant.messageId = assistantMessage.id;
      assistantMessage.subagents = rows;
    }
  }
  session.contextFilesCache = run.contextFilesCache || [];
  session.activeStreamContent = run.activeStreamContent || "";
  // The picker is the next-turn preference. Do not copy the in-flight
  // run's mode back onto the session, or a mid-reply Agent/Ask change
  // would snap back when the current turn finishes.
  session.chatFamily = run.family;
  session.selectedModel = run.model;
  const container = run.viewHost || (appState.activeChatSessionId === session.id ? messages : null);
  if (container) {
    const snapshot = captureChatSnapshot(container, sanitizePersistedChatHtml);
    session.transcript = snapshot.transcript;
    session.messagesHtml = snapshot.messagesHtml;
  }
  session.updatedAt = new Date().toISOString();
  if (appState.activeChatSessionId === session.id) {
    appState.chatHistory = session.history;
    appState.contextFilesCache = session.contextFilesCache;
    appState.activeStreamContent = session.activeStreamContent;
  }
  if (persist) schedulePersistChatSessions(session);
}
