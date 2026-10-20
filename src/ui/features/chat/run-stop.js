import { replyEndsWithStopped, appendStoppedPlainText } from "./transcript-replay.js";
import {
  setSubagentCardState, subagentCardBlocksParent, syncSubagentOrchestrationWaitStatus,
  chatSessionIdForRuntimeId,
} from "../../bootstrap.js";
import {
  activeChatRuns, isChatSessionRunning, activeSessionRun, syncAssistantDraftToHistory,
} from "./chat-run-state.js";
import { appState } from "../../core/app-state.js";
import { chatInput } from "../../core/dom-refs.js";
import { persistChatHistorySnapshot, reportChatHistoryWarning } from "./chat-persistence.js";
import { modeLabel } from "./chat-mode.js";
import { updateContextUsage } from "./context-usage.js";
import { setAgentStatus } from "./chat-messages.js";
import { updateSendBtn } from "./composer-input.js";
import {
  pendingComposerQuestionsBySession, composerQuestionSessionId,
  dismissOrchestratorEscalatedQuestionsForStop,
} from "./composer-questions.js";

export const chatSessionsStoppedByOperator = new Set();

export function collapseStoppedOrchestratorTurns(run) {
  const primary = run?.assistant?.rootTurn || run?.assistant?.turn;
  const exchange = primary?.closest?.(".chat-exchange");
  if (!primary || !exchange) return;
  const host = primary.querySelector(".agent-work-fold-body") || primary;
  for (const turn of [...exchange.querySelectorAll(".chat-turn.assistant")]) {
    if (turn === primary || turn.dataset.steeringSegment === "true") continue;
    for (const card of [...turn.querySelectorAll(".subagent-run-card")]) host.appendChild(card);
    const chunk = turn.closest(".agent-run-chunk");
    if (chunk && chunk !== primary.closest(".agent-run-chunk")) chunk.remove();
    else turn.remove();
  }
  const stoppedReplies = [...exchange.querySelectorAll(".assistant-reply")].filter(replyEndsWithStopped);
  stoppedReplies.slice(1).forEach((node) => node.remove());
  if (!stoppedReplies.length) appendStoppedPlainText(primary);
  for (const card of host.querySelectorAll(".subagent-run-card")) {
    if (subagentCardBlocksParent(card)) {
      setSubagentCardState(card, "stopped");
    }
  }
}

export function settleStoppedRun(run) {
  if (!run) return;
  run.stopRequested = true;
  run.orchestrationHold = false;
  run.pendingEndTurn = false;
  run.state = "complete";
  run.activeStreamContent = "";
  for (const turn of run.assistant?.assistantTurns?.() || [run.assistant?.turn]) {
    turn?.setAttribute("aria-busy", "false");
  }
  run.assistant?.finishLiveState?.("stopped");
  collapseStoppedOrchestratorTurns(run);
  syncSubagentOrchestrationWaitStatus(run);
  if (activeChatRuns.get(run.sessionId) === run) activeChatRuns.delete(run.sessionId);
}

export function settleDelegatedChildrenOf(run) {
  const parentIds = new Set(chatStopIdsForRun(run));
  if (!parentIds.size) return;
  for (const [sessionId, childRun] of [...activeChatRuns.entries()]) {
    if (!childRun?.delegated || childRun === run) continue;
    const parentId = String(childRun.session?.parentSessionId || "");
    const mappedParentId = chatSessionIdForRuntimeId(parentId);
    if (!parentId || (!parentIds.has(parentId) && !parentIds.has(mappedParentId))) continue;
    settleStoppedRun(childRun);
    if (activeChatRuns.get(sessionId) === childRun) activeChatRuns.delete(sessionId);
  }
}

export function stopGeneration() {
  const run = activeSessionRun();
  // Same condition that puts the composer into stop mode (see updateSendBtn).
  if (!run || !isChatSessionRunning(run.sessionId)) return;
  run.stopRequested = true;
  markChatSessionStoppedByOperator(run);
  dismissComposerQuestionsForStop(run);
  dropAutoContinuationsForSession(run.sessionId);
  dropAutoContinuationsForSession(run.memorySessionId || run.session?.memorySessionId || "");
  syncAssistantDraftToHistory(run, run.assistant, { persist: false });
  void persistChatHistorySnapshot(appState.activeChatPersistenceScope, run.session);
  appState.activeStreamContent = "";
  settleDelegatedChildrenOf(run);
  settleStoppedRun(run);
  if (chatInput && appState.activeChatSessionId === run.sessionId) {
    chatInput.disabled = false;
    chatInput.readOnly = false;
    chatInput.removeAttribute("aria-disabled");
  }
  setAgentStatus(`${modeLabel()} ready`);
  abortActiveChatRun(run);
  updateSendBtn();
  updateContextUsage();
}

export function chatStopIdsForRun(run) {
  return [...new Set([
    run?.memorySessionId,
    run?.session?.memorySessionId,
    run?.sessionId,
  ].map((value) => String(value || "")).filter(Boolean))];
}

export function markChatSessionStoppedByOperator(run) {
  for (const id of chatStopIdsForRun(run)) chatSessionsStoppedByOperator.add(id);
}

export function clearChatSessionStoppedByOperator(session) {
  chatSessionsStoppedByOperator.delete(String(session?.id || ""));
  chatSessionsStoppedByOperator.delete(String(session?.memorySessionId || ""));
}

export function isChatSessionStoppedByOperator(sessionId = "") {
  const id = String(sessionId || "");
  if (!id) return false;
  if (chatSessionsStoppedByOperator.has(id)) return true;
  const mapped = chatSessionIdForRuntimeId(id);
  return Boolean(mapped && chatSessionsStoppedByOperator.has(mapped));
}

export function abortActiveChatRun(run) {
  if (run.taskId || run.session?.taskId) {
    window.api.agentCancelTask?.({ workspace: run.workspace || appState.rootPath, sessionId: run.session?.parentMemorySessionId || run.memorySessionId || run.session?.memorySessionId || run.sessionId, taskId: run.taskId || run.session.taskId, scope: "task" })?.catch?.(reportChatHistoryWarning);
    return;
  }
  const ids = chatStopIdsForRun(run);
  if (!ids.length) {
    window.api.abortChat?.({});
    return;
  }
  for (const sessionId of ids) window.api.abortChat?.({ sessionId });
}

export function dismissComposerQuestionsForStop(run) {
  for (const sessionId of chatStopIdsForRun(run)) {
    const pending = pendingComposerQuestionsBySession.get(composerQuestionSessionId(sessionId));
    pending?.abort?.();
  }
  dismissOrchestratorEscalatedQuestionsForStop(run);
}

export function dropAutoContinuationsForSession(sessionId = "") {
  const id = String(sessionId || "");
  if (!id) return;
  const matches = (value) => {
    const candidate = String(value || "");
    if (!candidate) return false;
    if (candidate === id) return true;
    return chatSessionIdForRuntimeId(candidate) === id;
  };
  appState.pendingSubagentResults = appState.pendingSubagentResults.filter((item) => (
    !matches(item.parentSessionId) && !matches(item.payload?.parentSessionId) && !matches(item.payload?.sessionId)
  ));
  appState.pendingBackgroundWaitEvents = appState.pendingBackgroundWaitEvents.filter((item) => (
    !matches(item.payload?.sessionId) && !matches(item.payload?.parentSessionId)
  ));
}
