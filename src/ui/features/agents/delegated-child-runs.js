import { chatSessions, closedChatSessions, archivedChatSessions } from "../chat/chat-sessions.js";
import { activeChatRuns, chatRunContainer, syncChatRunSession } from "../chat/chat-run-state.js";
import {
  ensureSubagentSessionTab, summarizeSubagentActivity, createSubagentRunCard,
  setSubagentCardState, handleSubagentCardEvent, finalizeSubagentSessionTab, subagentCardKey,
} from "./subagent-cards.js";
import { createUserPromptBox } from "../chat/user-prompt-box.js";
import {
  chatExchangeBody, currentChatExchange, createChatExchange, setCollapsibleFoldExpanded,
  thinkingContentOf, setThinkingFoldLabel, appendChatStreamNode,
} from "../chat/turn-structure.js";
import { messages } from "../../core/dom-refs.js";
import { appState } from "../../core/app-state.js";
import { renderMarkdown, scrollMessages } from "../chat/chat-messages.js";
import { streamingNodeLive, createAssistantTurn } from "../chat/assistant-turn.js";
import { dismissOrchestratorEscalatedForChild, clearComposerTaskList } from "../chat/composer-questions.js";
import { updateSendBtn } from "../chat/composer-input.js";
import { handleParentSubagentLifecycle } from "./parent-continuation.js";

export function childRunSession(payload = {}) {
  const childSessionId = String(payload.childSessionId || payload.sessionId || "");
  return chatSessions.find((session) => session.id === childSessionId) || null;
}

export function ensureDelegatedChildRun(payload = {}) {
  const childSessionId = String(payload.childSessionId || payload.sessionId || "");
  if (!childSessionId) return null;
  ensureSubagentSessionTab(payload);
  const session = childRunSession(payload);
  if (!session) return null;
  let run = activeChatRuns.get(childSessionId);
  if (!run) {
    run = {
      sessionId: childSessionId,
      session,
      history: session.history || [],
      model: String(payload.model || session.selectedModel || ""),
      mode: session.chatMode || "agent",
      family: session.chatFamily || "xekute",
      contextPlan: null,
      contextFilesCache: [],
      activeStreamContent: "",
      viewHost: null,
      state: "running",
      stopRequested: false,
      assistantDraftFinalized: false,
      delegated: true,
    };
    activeChatRuns.set(childSessionId, run);
  }
  run.delegated = true;
  if (payload.taskId) { run.taskId = payload.taskId; run.session.taskId = payload.taskId; }
  const task = String(payload.task || run.session.orchestratorPrompt || "").trim();
  if (task) {
    run.session.orchestratorPrompt = task;
    if (!run.history.some((message) => message?.role === "user")) {
      run.history.unshift({
        role: "user",
        content: task,
        id: `${childSessionId}-orchestrator-prompt`,
        createdAt: new Date().toISOString(),
      });
    }
    run.session.history = run.history;
  }
  // Keep a detached view host while the child tab is closed so its transcript
  // is ready when the operator clicks the row.
  childAssistant(run);
  ensureDelegatedUserPrompt(run, task);
  return run;
}

export function ensureDelegatedUserPrompt(run, task = "") {
  const text = String(task || run?.session?.orchestratorPrompt || "").trim();
  if (!text || !run?.session) return;
  run.session.orchestratorPrompt = text;
  const container = chatRunContainer(run);
  if (!container?.querySelector) return;
  if (container.querySelector(".chat-turn.user")) return;
  const turn = document.createElement("div");
  turn.className = "chat-turn user";
  turn.dataset.createdAt = new Date().toISOString();
  turn.appendChild(createUserPromptBox(text));
  const assistantTurn = run.assistant?.turn;
  const exchange = assistantTurn?.closest?.(".chat-exchange") || currentChatExchange(container);
  const body = chatExchangeBody(exchange);
  const host = body?.querySelector?.(":scope > .agent-response-host");
  if (host) body.insertBefore(turn, host);
  else body?.prepend?.(turn);
}

export function ensureVisibleDelegatedPrompt(session) {
  if (!session || session.kind !== "subagent" || !messages) return;
  if (messages.querySelector(".chat-turn.user")) return;
  const fromHistory = (Array.isArray(session.history) ? session.history : []).find((message) => message?.role === "user");
  const text = String(session.orchestratorPrompt || fromHistory?.content || "").trim();
  if (!text) return;
  session.orchestratorPrompt = text;
  const turn = document.createElement("div");
  turn.className = "chat-turn user";
  turn.dataset.createdAt = fromHistory?.createdAt || new Date().toISOString();
  turn.appendChild(createUserPromptBox(text));
  const exchange = messages.querySelector(".chat-exchange") || createChatExchange(messages);
  const body = chatExchangeBody(exchange);
  const host = body?.querySelector?.(":scope > .agent-response-host");
  if (host) body.insertBefore(turn, host);
  else body?.prepend?.(turn);
}

export function runIsChildVisible(childSessionId = "") {
  return appState.activeChatSessionId === childSessionId;
}

export function childAssistant(run) {
  if (!run) return null;
  if (!run.assistant) {
    run.assistant = createAssistantTurn({ container: chatRunContainer(run), sessionId: run.sessionId });
    run.assistant.contentEl.classList.add("streaming");
    if (run.delegated) {
      const baseEnsure = run.assistant.ensureThinkingFold.bind(run.assistant);
      run.assistant.ensureThinkingFold = function delegatedEnsureThinkingFold() {
        if (run.thinkingFoldEl && run.thinkingFoldEl.dataset.final !== "true") {
          if (!streamingNodeLive(run.thinkingFoldEl)) {
            const host = this.activityBody() || this.conversationMount();
            if (host) appendChatStreamNode(host, run.thinkingFoldEl);
          }
          this.thinkingFoldEl = run.thinkingFoldEl;
          this.thinkingContentEl = thinkingContentOf(run.thinkingFoldEl);
          this.thinkingRaw = run.thinkingRaw || "";
          return run.thinkingFoldEl;
        }
        const fold = baseEnsure();
        run.thinkingFoldEl = this.thinkingFoldEl;
        run.thinkingRaw = this.thinkingRaw;
        return fold;
      };
      run.assistant.appendThinking = function delegatedAppendThinking(token) {
        const value = String(token || "");
        this.beginModelBlock();
        this.noteActivity();
        this.showPrivateReasoning();
        const fold = this.ensureThinkingFold();
        if (!fold) return;
        setThinkingFoldLabel(fold, { live: true });
        setCollapsibleFoldExpanded(fold, true);
        if (value) {
          this.thinkingRaw = `${this.thinkingRaw || ""}${value}`;
          const content = thinkingContentOf(fold) || this.thinkingContentEl;
          if (content) {
            content.hidden = false;
            renderMarkdown(content, this.thinkingRaw, { streaming: true });
          }
        }
        run.thinkingFoldEl = this.thinkingFoldEl;
        run.thinkingRaw = this.thinkingRaw;
        if (runIsChildVisible(run.sessionId)) scrollMessages();
      };
      run.assistant.syncDisplay = function delegatedSyncDisplay() {
        const segment = this.currentContentSegment();
        if (!segment) return;
        const raw = String(segment.raw || "");
        const text = ToolParser.cleanReplyForDisplay(raw, { streaming: true }) || raw.trim();
        if (text) {
          segment.el.hidden = false;
          renderMarkdown(
            segment.el,
            text,
            { streaming: segment.el.classList.contains("streaming") },
          );
        }
        if (runIsChildVisible(run.sessionId)) scrollMessages();
      };
    }
  }
  return run.assistant;
}

export function handleDelegatedChildEvent(payload = {}) {
  const type = String(payload.type || "");
  if (!type.startsWith("subagent_")) return;
  const childSessionId = String(payload.childSessionId || payload.sessionId || "");

  if (payload.parentSessionId && String(payload.sessionId || "") === String(payload.parentSessionId)) {
    handleParentSubagentLifecycle(payload);
    return;
  }

  if (type === "subagent_queued" || type === "subagent_started") {
    const run = ensureDelegatedChildRun(payload);
    if (run) {
      run.state = "running";
      run.lifecycleStatus = "running";
      run.model = String(payload.model || run.model || "");
      run.session.selectedModel = run.model;
      childAssistant(run)?.setLiveState({ kind: "working", detail: type === "subagent_queued" ? "Queued…" : summarizeSubagentActivity(payload) });
      // Parent card (mirrored payloads carry parentSessionId).
      if (payload.parentSessionId) {
        const parentRun = activeChatRuns.get(chatSessionIdForRuntimeId(payload.parentSessionId)) || activeChatRuns.get(payload.parentSessionId);
        if (parentRun?.assistant) {
          const card = createSubagentRunCard(parentRun.assistant, payload);
          if (card) {
            card.dataset.model = String(payload.model || "");
            setSubagentCardState(card, type === "subagent_queued" ? "queued" : "working");
          }
          syncChatRunSession(parentRun);
        }
      }
      syncChatRunSession(run);
    }
    return;
  }

  // Route child-scoped events into the child's live run, and mirror updates to
  // the parent card when the payload carries a parentSessionId.
  const run = activeChatRuns.get(childSessionId)
    || (["subagent_completed", "subagent_stopped", "subagent_failed"].includes(type)
      ? ensureDelegatedChildRun(payload)
      : null);
  const assistant = run ? childAssistant(run) : null;

  if (type === "subagent_activity") {
    if (assistant) {
      assistant.setStatus(summarizeSubagentActivity(payload));
      syncChatRunSession(run);
    }
    if (payload.parentSessionId) {
      const parentRun = activeChatRuns.get(chatSessionIdForRuntimeId(payload.parentSessionId)) || activeChatRuns.get(payload.parentSessionId);
      if (parentRun?.assistant) {
        handleSubagentCardEvent(parentRun.assistant, payload);
        syncChatRunSession(parentRun);
      }
    }
    return;
  }

  if (type === "subagent_waiting") {
    if (run) {
      run.state = "running";
      run.lifecycleStatus = "waiting";
      assistant?.setLiveState?.({ kind: "waiting", detail: "Waiting for another task or a checkpoint" });
      syncChatRunSession(run);
    }
    handleParentSubagentLifecycle(payload);
    updateSendBtn();
    return;
  }

  if (type === "subagent_completed" || type === "subagent_stopped" || type === "subagent_failed") {
    dismissOrchestratorEscalatedForChild(childSessionId);
    const stopped = type === "subagent_stopped";
    if (assistant) {
      assistant.finalOutcome = stopped ? "stopped" : type === "subagent_failed" ? "error" : "complete";
      if (stopped) {
        assistant.finishLiveState("stopped");
      } else {
        if (!assistant.rawContent.trim() && type === "subagent_failed") {
          assistant.setRawContent(String(payload.summary || "").trim() || "Sub-agent failed.");
        }
        assistant.finalizeContent();
      }
    }
    if (run) {
      if (assistant) {
        const finalText = assistant.rawContent.trim();
        let message = [...run.history].reverse().find((item) => item?.role === "assistant");
        if (!message) {
          message = { role: "assistant", content: finalText, id: `${childSessionId}-assistant-${Date.now()}`, createdAt: new Date().toISOString() };
          run.history.push(message);
        } else if (finalText) message.content = finalText;
      }
      run.state = "complete";
      if (run.taskList?.source === "agent") {
        run.taskList = null;
        if (runIsChildVisible(childSessionId)) clearComposerTaskList();
      }
      run.lifecycleStatus = stopped ? "stopped" : type === "subagent_failed" ? "failed" : "completed";
      run.delegated = false;
      if (run.assistant) run.assistant.turn.setAttribute("aria-busy", "false");
      syncChatRunSession(run);
    }
    if (payload.parentSessionId) {
      const parentRun = activeChatRuns.get(chatSessionIdForRuntimeId(payload.parentSessionId)) || activeChatRuns.get(payload.parentSessionId);
      if (parentRun?.assistant) {
        handleSubagentCardEvent(parentRun.assistant, payload);
        syncChatRunSession(parentRun);
      }
    }
    finalizeSubagentSessionTab(payload);
    updateSendBtn();
  }
}

export function persistedSubagentRowForSession(session, payload = {}) {
  if (!session) return null;
  const key = subagentCardKey(payload);
  if (!key) return null;
  let message = [...(Array.isArray(session.history) ? session.history : [])].reverse().find((item) => item?.role === "assistant");
  if (!message) {
    message = {
      role: "assistant",
      content: "",
      id: `${session.id}-assistant-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    session.history = [...(Array.isArray(session.history) ? session.history : []), message];
  }
  const rows = Array.isArray(message.subagents) ? message.subagents : [];
  let row = rows.find((item) => subagentCardKey(item) === key);
  if (!row) {
    row = {
      childInvocationId: String(payload.childInvocationId || ""),
      childSessionId: String(payload.childSessionId || ""),
      independent: Boolean(payload.independent),
      taskId: String(payload.taskId || ""),
      parentSessionId: String(payload.parentSessionId || session.id),
      model: String(payload.model || ""),
      status: String(payload.status || (payload.type === "subagent_queued" ? "queued" : "working")),
      summary: summarizeSubagentActivity(payload),
    };
    rows.push(row);
    message.subagents = rows;
  }
  if (payload.independent) row.independent = true;
  if (payload.taskId) row.taskId = String(payload.taskId);
  if (payload.model) row.model = String(payload.model);
  if (payload.status) row.status = String(payload.status);
  if (payload.type === "subagent_queued") row.status = "queued";
  if (payload.type === "subagent_started") row.status = "working";
  if (payload.type === "subagent_waiting") row.status = "waiting";
  if (payload.type === "subagent_completed") row.status = "completed";
  if (payload.type === "subagent_stopped") row.status = "stopped";
  if (payload.type === "subagent_failed") row.status = "failed";
  if (payload.summary || payload.task) row.summary = summarizeSubagentActivity(payload);
  session.updatedAt = new Date().toISOString();
  return row;
}

export function chatSessionIdForRuntimeId(runtimeId = "") {
  const id = String(runtimeId || "");
  if (!id) return "";
  const allSessions = [...chatSessions, ...closedChatSessions, ...archivedChatSessions];
  const direct = allSessions.find((session) => session.id === id);
  if (direct) return direct.id;
  const memoryMatch = allSessions.find((session) => session.memorySessionId === id);
  if (memoryMatch) return memoryMatch.id;
  for (const run of activeChatRuns.values()) {
    if (String(run?.memorySessionId || run?.session?.memorySessionId || "") === id) return run.sessionId;
  }
  return id;
}

export function updateRenderedSubagentCard(payload = {}, root = messages) {
  const key = subagentCardKey(payload);
  if (!key || !root?.querySelectorAll) return false;
  const card = [...root.querySelectorAll(".subagent-run-card")].find(
    (item) => (item.dataset.childInvocationId || item.dataset.childSessionId) === key,
  );
  if (!card) return false;
  if (payload.model) card.dataset.model = String(payload.model);
  const type = String(payload.type || "");
  if (type === "subagent_queued") setSubagentCardState(card, "queued");
  else if (type === "subagent_started") setSubagentCardState(card, "working");
  else if (type === "subagent_waiting") setSubagentCardState(card, "waiting");
  else if (type === "subagent_completed") setSubagentCardState(card, "completed");
  else if (type === "subagent_stopped") setSubagentCardState(card, "stopped");
  else if (type === "subagent_failed") setSubagentCardState(card, "failed");
  else if (type === "subagent_activity") setSubagentCardState(card, card.dataset.state || "working");
  return true;
}
