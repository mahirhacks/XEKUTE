import {
  allKnownChatSessions, chatSessions, loadChatSession, renderChatSessionSelect,
} from "../chat/chat-sessions.js";
import { reopenChatSession } from "../chat/chat-history-popover.js";
import { activeChatRuns, settleVisibleParentRun } from "../chat/chat-run-state.js";
import { markActivityNode, appendChatStreamNode } from "../chat/turn-structure.js";
import { markAssistantToolUse } from "../chat/tool-cards.js";
import { messages } from "../../core/dom-refs.js";
import {
  createChatSession, clearChatSessionState, schedulePersistChatSessions,
} from "../chat/chat-persistence.js";

export function subagentCardTitle({ model = "", status = "running", childInvocationId = "" } = {}) {
  const modelLabel = String(model || "").trim();
  const modelSuffix = modelLabel ? ` (${modelLabel})` : "";
  void childInvocationId;
  void status;
  return `Sub-agent${modelSuffix}`;
}

export function subagentCardStatus(status = "working") {
  return {
    queued: "Queued…",
    running: "Working…",
    working: "Working…",
    waiting: "Waiting…",
    completed: "Finished working.",
    stopped: "Stopped",
    failed: "Failed.",
  }[String(status || "working")] || "Working…";
}

export function summarizeSubagentActivity(payload = {}) {
  return String(payload.summary || payload.task || payload.activity || "Working on the delegated task").trim().slice(0, 240);
}

export function subagentCardKey(payload = {}) {
  return String(payload.childInvocationId || payload.childSessionId || payload.sessionId || "");
}

export function findSubagentChatSession(card) {
  const childSessionId = String(card?.dataset?.childSessionId || "");
  const childInvocationId = String(card?.dataset?.childInvocationId || "");
  const matches = (session) => session
    && (
      (childSessionId && (session.id === childSessionId || session.memorySessionId === childSessionId))
      || (childInvocationId && session.childInvocationId === childInvocationId)
    );
  return allKnownChatSessions().find(matches) || null;
}

export function openSubagentChat(card) {
  if (!card) return;
  let session = findSubagentChatSession(card);
  if (!session) {
    const childSessionId = String(card.dataset.childSessionId || "");
    if (!childSessionId) return;
    ensureSubagentSessionTab({
      childSessionId,
      childInvocationId: card.dataset.childInvocationId || "",
      parentSessionId: card.dataset.parentSessionId || "",
      model: card.dataset.model || "",
      task: card.querySelector(".subagent-run-detail")?.textContent || "",
      status: card.dataset.state || "",
    });
    session = chatSessions.find((item) => item.id === childSessionId) || null;
  }
  if (!session) return;
  if (!chatSessions.some((item) => item.id === session.id)) reopenChatSession(session.id, { closePopover: false });
  else loadChatSession(session.id);
}

export function wireSubagentRunCard(card) {
  if (!card || card.dataset.interactionsBound === "1") return card;
  card.dataset.interactionsBound = "1";
  const openChild = () => openSubagentChat(card);
  card.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".subagent-run-stop")) return;
    event.preventDefault();
    event.stopPropagation();
    openChild();
  });
  card.addEventListener("click", (event) => {
    if (event.target.closest(".subagent-run-stop")) return;
    event.preventDefault();
    event.stopPropagation();
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openChild();
    }
  });
  card.querySelector(".subagent-run-stop")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const childSessionId = card.dataset.childSessionId || "";
    window.api.abortChat?.({ sessionId: childSessionId });
    setSubagentCardState(card, "stopped");
    activeChatRuns.get(childSessionId)?.assistant?.finishLiveState?.("stopped");
  });
  return card;
}

export function createSubagentRunCard(assistant, payload = {}, mount = null) {
  if (!assistant?.turn) return null;
  const key = subagentCardKey(payload);
  const existing = [...assistant.turn.querySelectorAll(".subagent-run-card")].find(
    (card) => (card.dataset.childInvocationId || card.dataset.childSessionId) === key,
  );
  if (existing) {
    if (payload.independent) existing.dataset.independent = "true";
    if (payload.taskId) existing.dataset.taskId = String(payload.taskId);
    return existing;
  }
  markAssistantToolUse(assistant.turn);

  const card = document.createElement("div");
  card.className = "subagent-run-card";
  card.dataset.childInvocationId = String(payload.childInvocationId || "");
  card.dataset.childSessionId = String(payload.childSessionId || "");
  card.dataset.independent = payload.independent ? "true" : "false";
  card.dataset.taskId = String(payload.taskId || "");
  card.dataset.parentSessionId = String(payload.parentSessionId || "");
  card.dataset.model = String(payload.model || "");
  card.dataset.state = String(payload.status || (payload.type === "subagent_queued" ? "queued" : "working"));
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", "Sub-agent is working. Click to open its chat.");

  const body = document.createElement("span");
  body.className = "subagent-run-body";

  const title = document.createElement("strong");
  title.className = "subagent-run-title";
  title.textContent = subagentCardTitle({ model: payload.model });

  const detail = document.createElement("span");
  detail.className = "subagent-run-detail";
  detail.textContent = subagentCardStatus(card.dataset.state);

  body.append(title, detail);

  const stop = document.createElement("button");
  stop.type = "button";
  stop.className = "subagent-run-stop";
  stop.title = "Stop sub-agent";
  stop.setAttribute("aria-label", "Stop sub-agent");
  stop.innerHTML = '<span class="codicon codicon-debug-pause" aria-hidden="true"></span>';

  card.append(body, stop);

  assistant.subagentRows = assistant.subagentRows || new Map();
  assistant.subagentRows.set(key, {
    childInvocationId: card.dataset.childInvocationId,
    childSessionId: card.dataset.childSessionId,
    parentSessionId: card.dataset.parentSessionId,
    model: String(payload.model || ""),
    state: card.dataset.state,
    summary: summarizeSubagentActivity(payload),
  });
  // Keep delegated rows below the parent's prose and tool timeline.
  if (typeof assistant.markToolUse === "function") assistant.markToolUse();
  markActivityNode(card);
  const host = mount || (typeof assistant.toolWorkMount === "function" ? assistant.toolWorkMount() : assistant.turn);
  appendChatStreamNode(host, card);
  wireSubagentRunCard(card);
  setSubagentCardState(card, card.dataset.state);
  return card;
}

export function setSubagentCardState(card, status = "running", detail = "") {
  if (!card) return;
  if (card.dataset.state === "stopped" && status !== "stopped" && status !== "failed") return;
  card.dataset.state = status;
  const title = card.querySelector(".subagent-run-title");
  if (title) title.textContent = subagentCardTitle({ model: card.dataset.model || "", status });
  const detailEl = card.querySelector(".subagent-run-detail");
  if (detailEl) detailEl.textContent = String(detail || subagentCardStatus(status)).slice(0, 240);
  const stop = card.querySelector(".subagent-run-stop");
  if (stop) stop.hidden = !["queued", "running", "working", "waiting"].includes(String(status));
  card.setAttribute("aria-label", title?.textContent || "Sub-agent");
  const assistant = findAssistantForTurn(card.closest(".chat-turn"));
  syncSubagentOrchestrationWaitStatus(assistant);
  const run = chatRunForAssistant(assistant);
  if (run && !subagentCardIsActive(card)) settleVisibleParentRun(run);
}

export function chatRunForAssistant(assistant) {
  if (!assistant) return null;
  for (const run of activeChatRuns.values()) {
    if (run.assistant === assistant) return run;
  }
  return null;
}

export function findAssistantForTurn(turn) {
  if (!turn) return null;
  for (const run of activeChatRuns.values()) {
    const assistant = run.assistant;
    if (!assistant) continue;
    if (assistant.turn === turn || assistant.rootTurn === turn || assistant.assistantTurns?.().includes(turn)) {
      return assistant;
    }
  }
  return null;
}

export function subagentCardBlocksParent(card) {
  return card?.dataset?.independent !== "true" && subagentCardIsActive(card);
}

export function subagentCardIsActive(card) {
  return ["queued", "running", "working", "waiting"].includes(String(card?.dataset?.state || ""));
}

export function markSubagentQuestionWaiting(payload = {}, waiting = false) {
  const key = subagentCardKey(payload);
  if (!key || !messages?.querySelectorAll) return;
  const card = [...messages.querySelectorAll(".subagent-run-card")].find(
    (item) => (item.dataset.childInvocationId || item.dataset.childSessionId) === key,
  );
  if (card) card.dataset.pendingQuestion = waiting ? "true" : "false";
  const status = card?.parentElement?.querySelector(":scope > .subagent-orchestration-wait");
  if (status) status.dataset.questionQueueDepth = String(Math.max(0, Number(payload.questionQueueDepth) || (waiting ? 1 : 0)));
  const assistant = findAssistantForTurn(card?.closest(".chat-turn"));
  if (assistant) syncSubagentOrchestrationWaitStatus(assistant);
}

export function syncSubagentOrchestrationWaitStatus(source) {
  let assistant = null;
  let run = null;
  if (source?.assistant) {
    run = source;
    assistant = run.assistant;
  } else if (source?.toolWorkMount) {
    assistant = source;
    run = chatRunForAssistant(assistant);
  }
  if (!assistant?.toolWorkMount) return;
  const host = assistant.toolWorkMount();
  if (!host) return;

  const cards = [...host.querySelectorAll(":scope > .subagent-run-card")].filter((card) => card.dataset.independent !== "true");
  const holdActive = Boolean(run?.orchestrationHold) && !run?.stopRequested;
  const hasActiveCards = cards.some(subagentCardIsActive);
  const shouldShow = cards.length > 0 && !run?.stopRequested && (holdActive || hasActiveCards);

  let status = host.querySelector(":scope > .subagent-orchestration-wait");
  if (!shouldShow) {
    status?.remove();
    return;
  }

  if (!status) {
    status = document.createElement("div");
    status.className = "subagent-orchestration-wait agent-status-line";
    status.dataset.state = "waiting";
    status.dataset.orchestrationRoster = "true";
    status.setAttribute("role", "status");
    status.innerHTML = '<span class="agent-status-text"></span>';
  }
  const working = cards.filter(subagentCardIsActive).length;
  const finished = Math.max(0, cards.length - working);
  const waitingQuestions = cards.filter((card) => card.dataset.pendingQuestion === "true").length
    || Number(status.dataset.questionQueueDepth || 0);
  const text = status.querySelector(".agent-status-text");
  if (text) {
    const questionLabel = waitingQuestions > 0
      ? ` · ${waitingQuestions} question${waitingQuestions === 1 ? "" : "s"} waiting`
      : "";
    text.textContent = `Waiting for sub-agents · ${working} working · ${finished} finished${questionLabel}`;
  }

  const anchor = cards.at(-1)
    || host.querySelector(":scope > .tool-card[data-tool-action='delegate_agent']");
  if (anchor) anchor.insertAdjacentElement("afterend", status);
  else host.appendChild(status);
}

export function handleSubagentCardEvent(assistant, payload = {}) {
  const type = String(payload.type || "");
  const key = subagentCardKey(payload);
  if (!key || !assistant?.turn) return;
  const card = [...assistant.turn.querySelectorAll(".subagent-run-card")].find(
    (item) => (item.dataset.childInvocationId || item.dataset.childSessionId) === key,
  );
  if (!card) return;
  if (payload.model) card.dataset.model = String(payload.model);
  if (type === "subagent_queued" || type === "subagent_started") {
    setSubagentCardState(card, type === "subagent_queued" ? "queued" : "working");
    return;
  }
  if (type === "subagent_activity") {
    setSubagentCardState(card, card.dataset.state || "working");
    return;
  }
  if (type === "subagent_waiting") setSubagentCardState(card, "waiting");
  if (type === "subagent_completed") setSubagentCardState(card, "completed");
  if (type === "subagent_stopped") setSubagentCardState(card, "stopped");
  if (type === "subagent_failed") setSubagentCardState(card, "failed");
}

// Ensure a chat session tab exists for a delegated child. The child is created
// on the main process; here we register it in the renderer's session list so
// the operator can open and watch it without a reload.
export function ensureSubagentSessionTab(payload = {}) {
  const childSessionId = String(payload.childSessionId || "");
  if (!childSessionId) return;
  if (chatSessions.some((session) => session.id === childSessionId)) {
    const existing = chatSessions.find((session) => session.id === childSessionId);
    if (existing) {
      existing.memoryBlockId = String(payload.blockId || existing.memoryBlockId || "");
      existing.memoryProjectId = String(payload.projectId || existing.memoryProjectId || "");
    }
    renderChatSessionSelect();
    return;
  }
  const session = createChatSession("Sub-agent");
  session.id = childSessionId;
  session.kind = "subagent";
  session.parentSessionId = String(payload.parentSessionId || "");
  session.childInvocationId = String(payload.childInvocationId || "");
  session.selectedModel = String(payload.model || session.selectedModel || "");
  session.title = `Sub-agent: ${summarizeSubagentActivity(payload).slice(0, 60)}`;
  clearChatSessionState(session);
  // clearChatSessionState resets memory ids; restore the child's after it.
  session.memorySessionId = childSessionId;
  session.memoryBlockId = String(payload.blockId || "");
  session.memoryProjectId = String(payload.projectId || "");
  chatSessions.push(session);
  renderChatSessionSelect();
  schedulePersistChatSessions();
}

export function finalizeSubagentSessionTab(payload = {}) {
  const childSessionId = String(payload.childSessionId || "");
  if (!childSessionId) return;
  const session = chatSessions.find((item) => item.id === childSessionId);
  if (!session) return;
  session.title = session.title || `Sub-agent: ${summarizeSubagentActivity(payload).slice(0, 60)}`;
  renderChatSessionSelect();
  schedulePersistChatSessions();
}
