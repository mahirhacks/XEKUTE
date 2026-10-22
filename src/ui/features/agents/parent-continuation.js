import {
  chatSessions, closedChatSessions, archivedChatSessions, syncActiveChatSession,
} from "../chat/chat-sessions.js";
import { messages } from "../../core/dom-refs.js";
import {
  sanitizePersistedChatHtml, schedulePersistChatSessions, applyCheckpointToSession,
  scheduleLiveChatSnapshot,
} from "../chat/chat-persistence.js";
import { captureSessionTranscript } from "../chat/transcript-replay.js";
import {
  activeChatRuns, syncChatRunSession, syncAssistantDraftToHistory, isChatSessionRunning,
  chatRunContainer, discardAssistantDraft,
} from "../chat/chat-run-state.js";
import {
  createSubagentRunCard, setSubagentCardState, handleSubagentCardEvent,
  syncSubagentOrchestrationWaitStatus, subagentCardBlocksParent,
} from "./subagent-cards.js";
import {
  persistedSubagentRowForSession, chatSessionIdForRuntimeId, updateRenderedSubagentCard,
  ensureDelegatedChildRun, runIsChildVisible, childAssistant, handleDelegatedChildEvent,
} from "./delegated-child-runs.js";
import { appState } from "../../core/app-state.js";
import { storeLastContextUsage, updateContextUsage, applyContextReleaseUi } from "../chat/context-usage.js";
import {
  applyContextCheckpointUi, applyChatReferenceImportUi,
} from "../chat/context-checkpoints.js";
import {
  scrollMessages, setAgentStatus, isSilentToolRoutingActivity, mergeAppendedChatMessages,
  addErrorMessage,
} from "../chat/chat-messages.js";
import {
  isEndTurnTool, applyEndTurnStopToUi, toolUiResult, toolActionName,
} from "../chat/tool-labels.js";
import { ensureToolCard, applyToolResultToUi } from "../chat/tool-cards.js";
import { isAgentTerminalTool } from "../chat/command-timeline.js";
import { isTaskListTool, renderComposerTaskList } from "../chat/composer-questions.js";
import { sendMessageWithAgentRuntime } from "../chat/agent-run.js";
import { isChatSessionStoppedByOperator } from "../chat/run-stop.js";
import { createAssistantTurn } from "../chat/assistant-turn.js";
import { MessageIdentity } from "../../core/runtime-globals.js";
import { modeLabel } from "../chat/chat-mode.js";
import { updateSendBtn } from "../chat/composer-input.js";

  export const subagentContinuationRuns = new Set();
  export const seenSubagentResultIds = new Set();

export async function recoverPendingSubagentResults() {
  if (typeof window.api?.pendingSubagentResults !== "function"
    && typeof window.api?.pendingParentContinuations !== "function") return;
  const sessionIds = [...chatSessions, ...closedChatSessions, ...archivedChatSessions]
    .flatMap((session) => [session.id, session.memorySessionId])
    .map((value) => String(value || ""))
    .filter(Boolean);
  try {
    if (typeof window.api?.pendingSubagentResults === "function") {
      const response = await window.api.pendingSubagentResults({ sessionIds });
      for (const result of Array.isArray(response?.results) ? response.results : []) {
        enqueueSubagentResult(result, { authoritative: true });
      }
    }
    if (typeof window.api?.pendingParentContinuations === "function") {
      const response = await window.api.pendingParentContinuations({ sessionIds });
      for (const entry of Array.isArray(response?.results) ? response.results : []) {
        handleHiddenBackgroundRuntimeEvent({
          type: "parent_continuation_complete",
          source: "parent_continuation",
          sessionId: entry.parentSessionId || entry.sessionId,
          parentSessionId: entry.parentSessionId || entry.sessionId,
          continuationResultId: entry.resultId,
          result: entry.result,
        });
      }
    }
  } catch (error) {
    console.warn("Could not recover pending sub-agent results:", error);
  }
}

export function handleParentSubagentLifecycle(payload = {}) {
  const parentSessionId = chatSessionIdForRuntimeId(payload.parentSessionId || payload.sessionId || "");
  const parentRun = activeChatRuns.get(parentSessionId);
  if (parentRun?.assistant) {
    if (payload.type === "subagent_queued" || payload.type === "subagent_started") {
      const card = createSubagentRunCard(parentRun.assistant, payload);
      if (card) setSubagentCardState(card, payload.type === "subagent_queued" ? "queued" : "working");
    } else {
      handleSubagentCardEvent(parentRun.assistant, payload);
    }
    syncChatRunSession(parentRun);
    return;
  }
  if (updateRenderedSubagentCard(payload, messages)) syncActiveChatSession();
  const session = [...chatSessions, ...closedChatSessions, ...archivedChatSessions]
    .find((item) => item.id === parentSessionId);
  if (session) {
    persistedSubagentRowForSession(session, payload);
    if (session.messagesHtml) {
      const host = document.createElement("div");
      host.innerHTML = session.messagesHtml;
      if (updateRenderedSubagentCard(payload, host)) {
        session.messagesHtml = sanitizePersistedChatHtml(host.innerHTML);
        captureSessionTranscript(session, host);
      }
    }
    schedulePersistChatSessions(session);
  }
}

export async function handleDelegatedChildRuntimeEvent(payload = {}) {
  const childSessionId = String(payload.childSessionId || "");
  if (!childSessionId || String(payload.sessionId || "") !== childSessionId) return;
  enqueueDelegatedChildEvent(childSessionId, async () => {
  const run = ensureDelegatedChildRun(payload);
  const assistant = childAssistant(run);
  if (!assistant) return;
  const type = String(payload.type || "");
  if (type === "task_list") {
    run.taskList = payload.clear ? null : { ...payload, source: "agent" };
    if (runIsChildVisible(childSessionId)) renderComposerTaskList(run.taskList || payload);
    scheduleDelegatedLiveSnapshot(run);
    return;
  }
  if (type === "questions_required") {
    const response = await assistant.requestQuestions(payload);
    await window.api.agentResolveQuestions?.({
      requestId: payload.requestId,
      answers: response?.answers || [],
      skipped: Boolean(response?.skipped),
    });
    assistant.setStatus(response?.skipped ? "Clarification skipped" : "Clarification answers submitted");
    return;
  }
  if (type === "thinking") {
    assistant.setLiveState({ kind: "thinking", detail: "Thinking" });
    assistant.appendThinking(payload.token || payload.delta || "");
  } else if (type === "model_round") {
    assistant.applyModelRound(payload);
  } else if (type === "content" || type === "token") {
    const delta = String(payload.delta || payload.token || "");
    if (delta) {
      assistant.appendContent(delta);
      run.activeStreamContent = assistant.rawContent;
      syncAssistantDraftToHistory(run, assistant, { persist: false });
    }
  } else if (type === "status" || type === "activity") {
    if (payload.text || payload.summary) assistant.setStatus(String(payload.text || payload.summary));
  } else if (type === "run_state") {
    const phase = String(payload.state?.phase || "working").replace(/-/g, " ");
    assistant.setStatus(phase);
  } else if (type === "tool_call") {
    const tools = Array.isArray(payload.tools) ? payload.tools : [];
    assistant.beginModelBlock();
    if (tools.some((tool) => !isEndTurnTool(tool) && !isTaskListTool(tool))) assistant.noteModelOutput();
    for (const tool of tools) {
      if (isEndTurnTool(tool) || isTaskListTool(tool) || isAgentTerminalTool(tool)) continue;
      ensureToolCard(assistant.turn, assistant.contentEl, tool, { pending: true });
    }
  } else if (type === "tool_start" && payload.tool) {
    if (isEndTurnTool(payload.tool)) {
      assistant.finalizeThinking();
    } else {
      assistant.markToolUse();
      if (isAgentTerminalTool(payload.tool)) {
        const operation = String(payload.tool.args?.operation || "run");
        if (operation === "run" || operation === "start") assistant.ensureCommandEvent(payload.tool);
      } else ensureToolCard(assistant.turn, assistant.contentEl, payload.tool, { pending: true });
    }
  } else if (type === "tool_result" && payload.tool && payload.result) {
    if (isEndTurnTool(payload.tool)) {
      applyEndTurnStopToUi(assistant, payload.result);
    } else {
      const uiResult = toolUiResult(payload.result);
      if (isAgentTerminalTool(payload.tool)) assistant.completeCommandEvent(payload.tool, uiResult);
      else await applyToolResultToUi(payload.tool, uiResult, assistant.turn, assistant.contentEl);
    }
  } else if (type === "chat_reference_import") {
    applyChatReferenceImportUi(run, payload);
  } else if (type === "context_release") {
    applyContextReleaseUi(run, payload);
  } else if (type === "context_checkpoint") {
    applyCheckpointToSession(run.session, payload);
    applyContextCheckpointUi(run, payload);
    if (runIsChildVisible(childSessionId)) updateContextUsage();
  } else if (type === "context_usage" && payload.usage) {
    storeLastContextUsage(payload.usage, { session: run.session, model: run.model || appState.selectedModel, contextPlan: run.contextPlan });
    if (runIsChildVisible(childSessionId)) updateContextUsage();
  }
  scheduleDelegatedLiveSnapshot(run);
  if (runIsChildVisible(childSessionId)) scrollMessages();
  });
}

export function scheduleSubagentResultDrain(delay = 0) {
  if (Number(delay) > 0) {
    if (appState.subagentDrainRetryTimer) return;
    appState.subagentDrainRetryTimer = setTimeout(() => {
      appState.subagentDrainRetryTimer = null;
      drainPendingSubagentResults();
    }, Number(delay));
    return;
  }
  queueMicrotask(drainPendingSubagentResults);
}

export function enqueueSubagentResult(payload = {}, { authoritative = false } = {}) {
  const resultId = String(payload.resultId || "");
  const parentSessionId = chatSessionIdForRuntimeId(payload.parentSessionId || payload.sessionId || "");
  if (!resultId || !parentSessionId) return;
  if (appState.pendingSubagentResults.some((item) => item.resultId === resultId)) return;
  if (seenSubagentResultIds.has(resultId) && !authoritative) return;
  if (authoritative) seenSubagentResultIds.delete(resultId);
  seenSubagentResultIds.add(resultId);
  appState.pendingSubagentResults.push({ resultId, parentSessionId, payload });
  drainPendingSubagentResults();
}

export function drainPendingSubagentResults() {
  if (!appState.pendingSubagentResults.length) return;
  const next = appState.pendingSubagentResults[0];
  if (next) {
    const resolvedParentSessionId = chatSessionIdForRuntimeId(
      next.payload?.parentSessionId || next.payload?.sessionId || next.parentSessionId,
    );
    if (resolvedParentSessionId) next.parentSessionId = resolvedParentSessionId;
  }
  if (isChatSessionStoppedByOperator(next.parentSessionId)) {
    appState.pendingSubagentResults.shift();
    return;
  }
  if (!next
    || !chatSessions.some((session) => session.id === next.parentSessionId)
    || isChatSessionRunning(next.parentSessionId)
    || subagentContinuationRuns.has(next.parentSessionId)) return;
  appState.pendingSubagentResults.shift();
  subagentContinuationRuns.add(next.parentSessionId);
  let retryLater = false;
  Promise.resolve(sendMessageWithAgentRuntime({
    internal: true,
    sessionId: next.parentSessionId,
    continuation: { resultId: next.resultId },
    text: "Review the delegated result.",
  })).then((result) => {
    // A user stop intentionally pauses the claimed result in the coordinator.
    // Allow the next parent turn to receive the same result again.
    if (result?.aborted) {
      seenSubagentResultIds.delete(next.resultId);
      return;
    }
    // A result can arrive at the same boundary as a parent turn finishing.
    // Keep it queued only while the parent is busy. A not-ready response means
    // another turn already consumed the FIFO result, so retrying would create
    // a reload-time loop around a permanently stale result id.
    if (result?.ok === false && result.code === "PARENT_BUSY") {
      seenSubagentResultIds.delete(next.resultId);
      appState.pendingSubagentResults.unshift(next);
      retryLater = true;
    }
  }).catch(() => {}).finally(() => {
    subagentContinuationRuns.delete(next.parentSessionId);
    scheduleSubagentResultDrain(retryLater ? 250 : 0);
  });
}

export const parentContinuationEventQueues = new Map();
export const childEventLanes = new Map();
export const delegatedSnapshotTimers = new Map();

export function enqueueDelegatedChildEvent(childSessionId, handler) {
  const key = String(childSessionId || "");
  const prior = childEventLanes.get(key) || Promise.resolve();
  const next = prior.then(() => handler()).catch(() => {});
  childEventLanes.set(key, next);
  next.finally(() => {
    if (childEventLanes.get(key) === next) childEventLanes.delete(key);
  });
  return next;
}

export function scheduleDelegatedLiveSnapshot(run) {
  const key = String(run?.sessionId || "");
  if (delegatedSnapshotTimers.has(key)) return;
  delegatedSnapshotTimers.set(key, setTimeout(() => {
    delegatedSnapshotTimers.delete(key);
    scheduleLiveChatSnapshot(run);
  }, 150));
}

export function ensureParentContinuationRun(payload = {}) {
  const parentSessionId = chatSessionIdForRuntimeId(payload.parentSessionId || payload.sessionId || "");
  if (!parentSessionId) return null;
  const session = [...chatSessions, ...closedChatSessions, ...archivedChatSessions].find((item) => item.id === parentSessionId);
  if (!session) return null;
  if (isChatSessionStoppedByOperator(parentSessionId)) return null;
  let run = activeChatRuns.get(parentSessionId);
  if (run?.assistant?.turn?.isConnected) {
    run.parentContinuation = true;
    run.orchestrationHold = true;
    for (const turn of run.assistant.assistantTurns?.() || [run.assistant.turn]) {
      turn?.setAttribute("aria-busy", "true");
    }
    run.assistant.turn.closest(".chat-exchange")?.querySelectorAll(".assistant-reply-footer").forEach((node) => node.remove());
    return run;
  }
  if (!run || !run.parentContinuation) {
    const host = appState.activeChatSessionId === parentSessionId
      ? messages
      : (() => {
        const detached = document.createElement("div");
        detached.innerHTML = session.messagesHtml || "";
        return detached;
      })();
    run = {
      sessionId: parentSessionId,
      memorySessionId: session.memorySessionId || parentSessionId,
      session,
      history: Array.isArray(session.history) ? session.history : [],
      model: String(payload.model || session.selectedModel || ""),
      mode: session.chatMode || "agent",
      family: session.chatFamily || "xekute",
      contextPlan: null,
      contextFilesCache: session.contextFilesCache || [],
      activeStreamContent: "",
      viewHost: host === messages ? null : host,
      state: "running",
      stopRequested: false,
      assistantDraftFinalized: false,
      parentContinuation: true,
    };
    activeChatRuns.set(parentSessionId, run);
    run.assistant = createAssistantTurn({ container: host, sessionId: parentSessionId });
    run.assistant.contentEl.classList.add("streaming");
    run.assistant.setLiveState({ kind: "working", detail: "Reviewing delegated result" });
  }
  return run;
}

export async function renderParentContinuationEvent(payload = {}) {
  const type = String(payload.type || "");
  // Child lifecycle/runtime events mirrored during an automatic continuation
  // still use the normal child renderers; only parent-scoped model events are
  // rendered by the lightweight continuation run below.
  if (type === "subagent_result_ready" && payload.continuationOwner === "main") return;
  if (payload.childSessionId && String(payload.sessionId || "") === String(payload.childSessionId)) {
    if (payload.source === "parent_continuation") {
      if (payload.type === "subagent_queued" || payload.type === "subagent_started"
        || payload.type === "subagent_activity" || payload.type === "subagent_completed"
        || payload.type === "subagent_stopped" || payload.type === "subagent_failed") {
        handleDelegatedChildEvent(payload);
      } else {
        await handleDelegatedChildRuntimeEvent(payload);
      }
      return;
    }
  }
  if (type.startsWith("subagent_")) {
    handleDelegatedChildEvent(payload);
    return;
  }
  const run = ensureParentContinuationRun(payload);
  if (!run?.assistant) return;
  const assistant = run.assistant;
  const visible = appState.activeChatSessionId === run.sessionId && !run.viewHost;
  if (type === "task_list") {
    run.taskList = payload.clear ? null : { ...payload, source: "agent" };
    if (visible) renderComposerTaskList(run.taskList || payload);
  } else if (type === "thinking") {
    assistant.setLiveState({ kind: "thinking", detail: "Thinking" });
    assistant.appendThinking(payload.token || payload.delta || "");
  } else if (type === "model_round") {
    assistant.applyModelRound(payload);
  } else if (type === "content" || type === "token") {
    const delta = String(payload.delta || payload.token || "");
    if (delta) {
      assistant.appendContent(delta);
      run.activeStreamContent = assistant.rawContent;
      syncAssistantDraftToHistory(run, assistant, { persist: false });
    }
  } else if (type === "status") {
    assistant.setStatus(payload.text || "Working...");
  } else if (type === "activity") {
    if (payload.text && !isSilentToolRoutingActivity(payload.text)) assistant.noteTaskActivity(payload.text, payload.kind || "info");
  } else if (type === "output_continuation") {
    assistant.setStatus("Continuing the response…");
  } else if (type === "chat_reference_import") {
    applyChatReferenceImportUi(run, payload);
  } else if (type === "context_checkpoint") {
    applyCheckpointToSession(run.session, payload);
    applyContextCheckpointUi(run, payload);
    if (visible) updateContextUsage();
  } else if (type === "context_release") {
    applyContextReleaseUi(run, payload);
  } else if (type === "context_usage" && payload.usage) {
    storeLastContextUsage(payload.usage, { session: run.session, model: run.model, contextPlan: run.contextPlan });
    if (visible) updateContextUsage();
  } else if (type === "run_state") {
    const phase = String(payload.state?.phase || "working").replace(/-/g, " ");
    assistant.updateTaskStage(phase);
    assistant.setStatus(`${phase} · ${payload.state?.completionGate || "working"}`);
  } else if (type === "questions_required") {
    const response = await assistant.requestQuestions(payload);
    await window.api.agentResolveQuestions?.({
      requestId: payload.requestId,
      answers: response?.answers || [],
      skipped: Boolean(response?.skipped),
    });
    assistant.setStatus(response?.skipped ? "Clarification skipped" : "Clarification answers submitted");
  } else if (type === "tool_call") {
    assistant.finalizeThinking();
    const tools = Array.isArray(payload.tools) ? payload.tools : [];
    assistant.beginModelBlock();
    if (tools.some((tool) => !isEndTurnTool(tool) && !isTaskListTool(tool))) assistant.noteModelOutput();
    for (const tool of tools) {
      if (isEndTurnTool(tool) || isTaskListTool(tool) || isAgentTerminalTool(tool)) continue;
      ensureToolCard(assistant.turn, assistant.contentEl, tool, { pending: true });
    }
  } else if (type === "tool_start" && payload.tool) {
    if (isEndTurnTool(payload.tool)) {
      assistant.finalizeThinking();
    } else {
      assistant.markToolUse();
      assistant.finalizeThinking();
      if (isAgentTerminalTool(payload.tool)) {
        const operation = String(payload.tool.args?.operation || "run");
        if (operation === "run" || operation === "start") assistant.ensureCommandEvent(payload.tool);
      } else ensureToolCard(assistant.turn, assistant.contentEl, payload.tool, { pending: true });
    }
  } else if (type === "tool_result" && payload.tool && payload.result) {
    if (isEndTurnTool(payload.tool)) {
      applyEndTurnStopToUi(assistant, payload.result);
    } else {
      const uiResult = toolUiResult(payload.result);
      if (isAgentTerminalTool(payload.tool)) assistant.completeCommandEvent(payload.tool, uiResult);
      else await applyToolResultToUi(payload.tool, uiResult, assistant.turn, assistant.contentEl);
      if (toolActionName(payload.tool) === "browser_action" && [payload.result.code, payload.result.error?.code].includes("SCOPE_NOT_CONFIGURED")) showScopeRequiredNotice(assistant.contentEl);
    }
  } else if (type === "parent_continuation_complete") {
    const result = payload.result && typeof payload.result === "object" ? payload.result : {};
    if (Array.isArray(result.appendedMessages) && result.appendedMessages.length) {
      if (result.appendedMessages.some((message) => message?.role === "assistant" && String(message.content || "").trim())) {
        discardAssistantDraft(run, assistant);
      }
      const appended = MessageIdentity?.ensureMessageIdentity
        ? MessageIdentity.ensureMessageIdentity(result.appendedMessages, `${run.session.id}-agent`)
        : result.appendedMessages;
      mergeAppendedChatMessages(run.history, appended.map((message) => ({ ...message, createdAt: message.createdAt || new Date().toISOString() })));
    }
    const finalText = String(result.finalText || "").trim();
    if (finalText && !assistant.rawContent.trim()) assistant.setRawContent(finalText);
    if (result.error && !result.aborted) addErrorMessage(result.error, { container: chatRunContainer(run), session: run.session });
    run.awaitingParentContinuation = true;
    run.commandWait = Boolean(result.commandWait);
    run.orchestrationHold = Boolean(payload.orchestrationHold || result.orchestrationHold || run.orchestrationHold);
    run.pendingEndTurn = Boolean(payload.pendingEndTurn || result.pendingEndTurn || run.pendingEndTurn);
    assistant.finalizeContent();
    run.activeStreamContent = "";
    run.visibleSettled = false;
    run.state = "running";
    activeChatRuns.set(run.sessionId, run);
    assistant.turn?.setAttribute("aria-busy", "true");
    syncChatRunSession(run);
    syncSubagentOrchestrationWaitStatus(run);
    updateSendBtn();
    if (visible) setAgentStatus(`${modeLabel()} orchestrating…`);
    window.api.ackParentContinuation?.({
      sessionId: run.session.memorySessionId || run.session.id,
      resultId: payload.continuationResultId || "",
    }).catch?.(() => {});
    if (visible) scrollMessages();
    return;
  }
  scheduleLiveChatSnapshot(run);
  if (visible) scrollMessages();
}

export function showScopeRequiredNotice(anchor) {
  const turn = anchor?.parentElement;
  if (!turn || turn.querySelector(".browser-scope-notice")) return;
  const notice = document.createElement("div");
  notice.className = "browser-scope-notice";
  notice.innerHTML = '<span>Set a project scope before the agent can browse assessment targets.</span><button type="button" class="browser-scope-notice-action" data-open-project-settings="true">Open project settings</button>';
  anchor.after(notice);
}

export function releaseOrchestratorHold(sessionId = "", { hold = false } = {}) {
  const ids = new Set([String(sessionId || ""), chatSessionIdForRuntimeId(sessionId)].filter(Boolean));
  for (const [id, active] of activeChatRuns) {
    const matches = ids.has(id) || ids.has(active.sessionId) || ids.has(active.memorySessionId);
    if (!matches || active.parentContinuation) continue;
    active.orchestrationHold = hold;
    active.pendingEndTurn = hold ? active.pendingEndTurn : false;
    if (!hold) {
      active.state = "complete";
      if (activeChatRuns.get(id) === active) activeChatRuns.delete(id);
    }
    syncSubagentOrchestrationWaitStatus(active);
  }
  if (hold) return;
  messages?.querySelectorAll(".subagent-orchestration-wait").forEach((status) => {
    const host = status.parentElement;
    const stillWorking = [...(host?.querySelectorAll(":scope > .subagent-run-card") || [])].some(subagentCardBlocksParent);
    if (!stillWorking) status.remove();
  });
}

export function queueParentContinuationEvent(payload = {}) {
  const key = chatSessionIdForRuntimeId(payload.parentSessionId || payload.sessionId || "");
  if (!key) return;
  const prior = parentContinuationEventQueues.get(key) || Promise.resolve();
  const next = prior.then(() => renderParentContinuationEvent(payload)).catch(() => {});
  parentContinuationEventQueues.set(key, next);
  next.finally(() => {
    if (parentContinuationEventQueues.get(key) === next) parentContinuationEventQueues.delete(key);
  });
}

export function handleHiddenBackgroundRuntimeEvent(payload = {}) {
  if (payload?.type === "questions_required") {
    const delegated = Boolean(payload.delegatedChild)
      || Boolean(payload.childSessionId)
      || String(payload.source || "") === "subagent";
    if (!delegated) {
      window.api.agentResolveQuestions?.({ requestId: payload.requestId, answers: [], skipped: true });
    }
    return;
  }
  if (payload?.type !== "parent_continuation_complete") return;
  window.api.ackParentContinuation?.({
    sessionId: payload.parentSessionId || payload.sessionId || "",
    resultId: payload.continuationResultId || "",
  }).catch?.(() => {});
}
