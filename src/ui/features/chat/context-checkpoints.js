import { appState } from "../../core/app-state.js";
import { messages, chatInput } from "../../core/dom-refs.js";
import { chatExchangeBody, appendChatStreamNode } from "./turn-structure.js";
import { turnWorkFold, workFoldBody } from "./chat-work-fold.js";
import { chatRunContainer, syncChatRunSession, activeChatRuns } from "./chat-run-state.js";
import { modeLabel } from "./chat-mode.js";
import { updateContextUsage } from "./context-usage.js";
import { updateSendBtn } from "../../bootstrap.js";
import { setAgentStatus, scrollMessages } from "./chat-messages.js";

export const CONTEXT_SUMMARIZING_NOTICE = "Chat context being summarized...";
export const CONTEXT_SUMMARIZED_NOTICE = "Chat context summarized";
export const CONTEXT_SUMMARIZATION_INTERRUPTED_NOTICE = "Chat summarization interrupted";

export function pendingContextCheckpointNotice(container = messages) {
  if (appState.contextCheckpointNotice?.isConnected && appState.contextCheckpointNotice.dataset.state === "pending" && container?.contains?.(appState.contextCheckpointNotice)) return appState.contextCheckpointNotice;
  return container?.querySelector?.(".context-checkpoint-notice[data-state='pending']") || null;
}

// The notice is a sibling of each agent-run-chunk, not a child of the growing
// assistant turn. That keeps "Chat context summarized" at the moment the
// checkpoint happened instead of sliding under later tokens and tools.
export function lastAgentRunChunk(root) {
  if (!root?.querySelectorAll) return null;
  const host = root.classList?.contains("agent-response-host")
    ? root
    : root.querySelector?.(":scope > .agent-response-host") || root;
  const scoped = host.querySelectorAll(":scope > .agent-run-chunk");
  if (scoped.length) return scoped[scoped.length - 1];
  const nested = root.querySelectorAll(".agent-run-chunk");
  return nested.length ? nested[nested.length - 1] : null;
}

export function checkpointNoticeHost(container = messages) {
  const root = container || messages;
  if (!root) return null;
  const exchange = root.classList?.contains("chat-exchange")
    ? root
    : root.querySelector?.(":scope > .chat-exchange:last-child");
  const body = exchange ? chatExchangeBody(exchange) : root;
  return lastAgentRunChunk(body) || body || root;
}

export function ensureContextCheckpointNotice(container = messages, { text = CONTEXT_SUMMARIZING_NOTICE, state = "pending", assistant = null } = {}) {
  const host = container || messages;
  if (!host) return null;
  let notice = pendingContextCheckpointNotice(host);
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "context-checkpoint-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    const label = document.createElement("span");
    label.className = "context-checkpoint-text";
    notice.append(label);
    if (assistant?.splitAtContextCheckpoint) {
      assistant.splitAtContextCheckpoint(notice);
    } else {
      const turn = assistant?.turn || null;
      const foldBody = workFoldBody(turnWorkFold(turn));
      if (foldBody) appendChatStreamNode(foldBody, notice);
      else host.appendChild(notice);
    }
  }
  setContextCheckpointNoticeText(notice, text);
  notice.dataset.state = state;
  appState.contextCheckpointNotice = notice;
  return notice;
}

export function setContextCheckpointNoticeText(notice, text) {
  if (!notice) return;
  const label = notice.querySelector(".context-checkpoint-text");
  if (label) label.textContent = text;
  else notice.textContent = text;
}

export function hydrateContextCheckpointNotices(root = messages) {
  for (const notice of root.querySelectorAll?.(".context-checkpoint-notice") || []) {
    notice.querySelectorAll(":scope > .context-checkpoint-icon").forEach((icon) => icon.remove());
    if (notice.querySelector(".context-checkpoint-text")) continue;
    const text = String(notice.textContent || "").trim();
    notice.replaceChildren();
    const label = document.createElement("span");
    label.className = "context-checkpoint-text";
    label.textContent = text;
    notice.append(label);
  }
}

export function finishContextCheckpointNotice(container = messages, outcome = "completed") {
  const notice = pendingContextCheckpointNotice(container || messages);
  if (!notice) return null;
  const result = String(outcome || "").toLowerCase();
  const failed = result === "failed";
  const interrupted = result === "interrupted";
  setContextCheckpointNoticeText(notice, failed ? "Context checkpoint needs attention" : interrupted ? CONTEXT_SUMMARIZATION_INTERRUPTED_NOTICE : CONTEXT_SUMMARIZED_NOTICE);
  notice.dataset.state = failed ? "error" : interrupted ? "interrupted" : "complete";
  if (appState.contextCheckpointNotice === notice) appState.contextCheckpointNotice = null;
  return notice;
}

export function applyContextCheckpointUi(run, payload = {}) {
  if (run?.chatReferenceImportPending) return;
  const session = run?.session;
  const status = String(payload.status || "").toLowerCase();
  const active = status === "started" || status === "running";
  if (run) run.contextCheckpointPending = active;
  if (session) appState.contextCheckpointingSessionId = active ? session.id : (appState.contextCheckpointingSessionId === session.id ? "" : appState.contextCheckpointingSessionId);
  const container = chatRunContainer(run);
  if (active) {
    ensureContextCheckpointNotice(container, { assistant: run?.assistant });
    run?.assistant?.holdPlanningUntilCheckpoint?.();
  } else {
    finishContextCheckpointNotice(container, status);
    run?.assistant?.releasePlanningAfterCheckpoint?.();
  }
  const visible = Boolean(session && appState.activeChatSessionId === session.id && !run?.viewHost);
  setContextCheckpointUi(active && (visible || appState.contextCheckpointingSessionId === appState.activeChatSessionId));
  if (visible) {
    setAgentStatus(active ? CONTEXT_SUMMARIZING_NOTICE : status === "failed" ? "Context checkpoint needs attention" : `${modeLabel(run?.mode)} working`);
    if (!active) updateContextUsage();
    scrollMessages();
  }
  if (run) syncChatRunSession(run);
}

export function applyChatReferenceImportUi(run, payload = {}) {
  const active = payload.status === "started" || payload.status === "running";
  const text = "Bringing chats to this session...";
  const container = chatRunContainer(run);
  if (run) { run.chatReferenceImportPending = active; run.contextCheckpointPending = active; }
  if (run?.session) appState.contextCheckpointingSessionId = active ? run.session.id : (appState.contextCheckpointingSessionId === run.session.id ? "" : appState.contextCheckpointingSessionId);
  if (active) {
    const notice = ensureContextCheckpointNotice(container, { text, assistant: run?.assistant });
    if (notice) {
      notice.dataset.chatReferenceImport = "true";
      let fold = notice.querySelector(".chat-reference-fold");
      if (!fold) {
        fold = document.createElement("details");
        fold.className = "chat-reference-fold";
        const summary = document.createElement("summary");
        summary.className = "chat-reference-summary";
        summary.append(notice.querySelector(".context-checkpoint-text"));
        const caret = document.createElement("span");
        caret.className = "chat-reference-caret";
        caret.setAttribute("aria-hidden", "true");
        caret.textContent = "\u203a";
        summary.append(caret);
        fold.append(summary);
        const list = document.createElement("div");
        list.className = "chat-reference-names";
        fold.append(list);
        notice.append(fold);
      }
      const list = fold.querySelector(".chat-reference-names");
      const titles = Array.isArray(payload.titles) && payload.titles.length ? payload.titles : [payload.title || "Chat"];
      list.replaceChildren(...titles.map(title => {
        const item = document.createElement("div");
        item.className = "chat-reference-name";
        item.textContent = String(title);
        return item;
      }));
    }
    run?.assistant?.holdPlanningUntilCheckpoint?.();
  } else {
    const notice = container?.querySelector?.(".context-checkpoint-notice[data-chat-reference-import='true'][data-state='pending']");
    if (payload.status === "failed") {
      setContextCheckpointNoticeText(notice, "Could not bring chats");
      if (notice) notice.dataset.state = "error";
    } else {
      setContextCheckpointNoticeText(notice, "Brought chats");
      if (notice) notice.dataset.state = "complete";
    }
    if (appState.contextCheckpointNotice === notice) appState.contextCheckpointNotice = null;
    run?.assistant?.releasePlanningAfterCheckpoint?.();
  }
  const visible = Boolean(run?.session && appState.activeChatSessionId === run.session.id && !run.viewHost);
  if (visible) { setContextCheckpointUi(active); setAgentStatus(active ? text : payload.status === "failed" ? "Could not bring chats" : `${modeLabel(run.mode)} working`); scrollMessages(); }
  if (run) syncChatRunSession(run);
}

export function setContextCheckpointUi(checkpointing) {
  appState.contextCheckpointing = Boolean(checkpointing);
  if (!appState.contextCheckpointing) appState.contextCheckpointingSessionId = appState.contextCheckpointingSessionId && activeChatRuns.get(appState.contextCheckpointingSessionId)?.contextCheckpointPending
    ? appState.contextCheckpointingSessionId
    : "";
  const affectsActiveChat = appState.contextCheckpointing && (!appState.contextCheckpointingSessionId || appState.contextCheckpointingSessionId === appState.activeChatSessionId);
  if (chatInput) {
    chatInput.disabled = false;
    chatInput.readOnly = false;
    chatInput.removeAttribute("aria-disabled");
  }
  updateSendBtn();

}
