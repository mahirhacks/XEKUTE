import {
  setChatCollapsed, chatSessions, closedChatSessions, archivedChatSessions,
  applyActiveChatSession, renderChatSessionSelect, loadChatSession, unarchiveChatSession,
} from "./chat-sessions.js";
import {
  chatInput, chatHistoryPopover, chatHistoryBody, chatHistoryEmpty, chatHistorySearch,
  btnChatHistory, chatPane, contextUsageBtn, contextUsagePopover,
} from "../../core/dom-refs.js";
import { queueChatHistoryEvent, schedulePersistChatSessions } from "./chat-persistence.js";
import { closeModelMenu } from "../../bootstrap.js";
import { updateContextUsage, closeContextPopover, openContextPopover } from "./context-usage.js";
import { appState } from "../../core/app-state.js";
import {
  fitHistoryTitle, groupHistoryByAge, paginateRecentHistory, sortHistorySessions,
} from "../history/history-model.js";

export function openChatHistoryPicker() {
  setChatCollapsed(false);
  openChatHistoryPopover();
}

// Opens (reopens) a previously closed chat session, moving it back to the tab
// strip, then focuses it.
export function reopenChatSession(id, { closePopover = true } = {}) {
  if (archivedChatSessions.some((session) => session.id === id)) {
    unarchiveChatSession(id, { closePopover });
    return;
  }
  if (chatSessions.some((session) => session.id === id)) {
    loadChatSession(id);
    if (closePopover) closeChatHistoryPopover();
    return;
  }
  const closedIdx = closedChatSessions.findIndex((session) => session.id === id);
  if (closedIdx < 0) return;
  const [session] = closedChatSessions.splice(closedIdx, 1);
  chatSessions.push(session);
  applyActiveChatSession(session);
  queueChatHistoryEvent({ type: "reopen", sessionId: session.memorySessionId || "" }, { session });
  renderChatSessionSelect();
  updateContextUsage();
  schedulePersistChatSessions();
  if (closePopover) closeChatHistoryPopover();
  chatInput.focus();
}

export function createChatHistorySessionRow(session, { archived = false } = {}) {
  const row = document.createElement("div");
  row.className = `chat-history-session${session.id === appState.activeChatSessionId ? " active" : ""}${archived ? " archived" : ""}`;
  row.dataset.sessionId = session.id;
  row.title = session.title || "Untitled chat";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "chat-history-session-open";
  open.dataset.openSession = session.id;
  open.title = `Open ${session.title || "Untitled chat"}`;

  const icon = document.createElement("span");
  icon.className = "codicon codicon-pass chat-history-session-icon";
  icon.setAttribute("aria-hidden", "true");
  const title = document.createElement("span");
  title.className = "chat-history-session-title";
  title.dataset.fullTitle = session.title || "Untitled chat";
  title.textContent = title.dataset.fullTitle;

  open.appendChild(icon);
  open.appendChild(title);
  row.appendChild(open);

  const actions = document.createElement("span");
  actions.className = "chat-history-session-actions";

  const archive = document.createElement("button");
  archive.type = "button";
  archive.className = "chat-history-action chat-history-archive";
  archive.dataset.archiveSession = session.id;
  archive.title = archived ? "Reopen archived chat" : "Archive chat";
  archive.setAttribute("aria-label", archive.title);
  const archiveIcon = document.createElement("span");
  archiveIcon.className = `codicon ${archived ? "codicon-inbox" : "codicon-archive"}`;
  archiveIcon.setAttribute("aria-hidden", "true");
  archive.appendChild(archiveIcon);

  const trash = document.createElement("button");
  trash.type = "button";
  trash.className = "chat-history-action chat-history-trash";
  trash.title = "Delete chat permanently";
  trash.setAttribute("aria-label", trash.title);
  trash.dataset.destroySession = session.id;
  const trashIcon = document.createElement("span");
  trashIcon.className = "codicon codicon-trash";
  trashIcon.setAttribute("aria-hidden", "true");
  trash.appendChild(trashIcon);

  actions.appendChild(archive);
  actions.appendChild(trash);
  row.appendChild(actions);
  return row;
}

export function fitChatHistoryTitle(title) {
  fitHistoryTitle(title);
}

export function scheduleChatHistoryTitleFit() {
  const fit = () => {
    if (!chatHistoryPopover || chatHistoryPopover.hidden) return;
    chatHistoryPopover.querySelectorAll(".chat-history-session-title").forEach(fitChatHistoryTitle);
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fit);
  else setTimeout(fit, 0);
}

export function renderChatHistory() {
  if (!chatHistoryBody) return;
  const query = String(chatHistorySearch?.value || "").trim().toLocaleLowerCase();
  const recentById = new Map([...chatSessions, ...closedChatSessions].map((session) => [session.id, session]));
  const recent = sortHistorySessions([...recentById.values()], query);
  const archived = sortHistorySessions(archivedChatSessions, query);
  const matchingCount = recent.length + archived.length;
  const recentPage = paginateRecentHistory(recent, { showAll: appState.chatHistoryShowAllRecent });
  const visibleRecent = recentPage.visible;
  const remainingRecent = recentPage.remaining;

  chatHistoryBody.innerHTML = "";
  if (chatHistoryEmpty) {
    chatHistoryEmpty.textContent = query ? "No matching chats." : "No chat sessions yet.";
    chatHistoryEmpty.hidden = matchingCount !== 0;
  }

  for (const group of groupHistoryByAge(visibleRecent)) {
    const heading = document.createElement("div");
    heading.className = "chat-history-group-label";
    heading.textContent = group.label;
    chatHistoryBody.appendChild(heading);
    for (const session of group.sessions) chatHistoryBody.appendChild(createChatHistorySessionRow(session));
  }

  if (remainingRecent > 0) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "chat-history-more";
    more.dataset.chatHistoryMore = appState.chatHistoryShowAllRecent ? "less" : "more";
    more.textContent = appState.chatHistoryShowAllRecent ? "Show less" : `Show ${remainingRecent} more`;
    more.setAttribute("aria-label", more.textContent);
    chatHistoryBody.appendChild(more);
  }

  if (archivedChatSessions.length) {
    const archiveToggle = document.createElement("button");
    archiveToggle.type = "button";
    archiveToggle.className = "chat-history-archive-toggle";
    archiveToggle.dataset.toggleArchived = "true";
    archiveToggle.setAttribute("aria-expanded", String(appState.chatHistoryArchivedOpen));

    const archiveIcon = document.createElement("span");
    archiveIcon.className = `codicon codicon-chevron-right chat-history-archive-chevron${appState.chatHistoryArchivedOpen ? " expanded" : ""}`;
    archiveIcon.setAttribute("aria-hidden", "true");
    const archiveLabel = document.createElement("span");
    archiveLabel.textContent = "Archived";
    archiveToggle.appendChild(archiveIcon);
    archiveToggle.appendChild(archiveLabel);
    chatHistoryBody.appendChild(archiveToggle);

    if (appState.chatHistoryArchivedOpen) {
      if (!archived.length) {
        const emptyArchived = document.createElement("div");
        emptyArchived.className = "chat-history-archive-empty";
        emptyArchived.textContent = "No matching archived chats.";
        chatHistoryBody.appendChild(emptyArchived);
      } else {
        const archiveList = document.createElement("div");
        archiveList.className = "chat-history-archive-list";
        for (const session of archived) archiveList.appendChild(createChatHistorySessionRow(session, { archived: true }));
        chatHistoryBody.appendChild(archiveList);
      }
    }
  }
}

export function positionChatHistoryPopover() {
  if (!chatHistoryPopover || !btnChatHistory || !chatPane) return;
  chatHistoryPopover.style.width = "";
  const buttonRect = btnChatHistory.getBoundingClientRect();
  const paneRect = chatPane.getBoundingClientRect();
  const popH = chatHistoryPopover.offsetHeight || 300;
  const popW = Math.min(288, Math.max(232, paneRect.width - 24));
  chatHistoryPopover.style.width = `${popW}px`;

  let left = buttonRect.right - popW;
  if (left < paneRect.left + 6) left = paneRect.left + 6;
  let top = buttonRect.bottom + 6;
  if (top + popH > paneRect.bottom - 6) {
    top = Math.max(paneRect.top + 6, buttonRect.top - popH - 6);
  }
  chatHistoryPopover.style.left = `${left}px`;
  chatHistoryPopover.style.top = `${top}px`;
  scheduleChatHistoryTitleFit();
}

export function openChatHistoryPopover() {
  if (!chatHistoryPopover) return;
  closeModelMenu();
  closeContextPopover();
  appState.chatHistoryShowAllRecent = false;
  appState.chatHistoryArchivedOpen = false;
  renderChatHistory();
  chatHistoryPopover.hidden = false;
  btnChatHistory?.classList.add("active");
  btnChatHistory?.setAttribute("aria-expanded", "true");
  positionChatHistoryPopover();
}

export function closeChatHistoryPopover() {
  if (!chatHistoryPopover) return;
  chatHistoryPopover.hidden = true;
  btnChatHistory?.classList.remove("active");
  btnChatHistory?.setAttribute("aria-expanded", "false");
}

export function toggleChatHistoryPopover() {
  if (!chatHistoryPopover || chatHistoryPopover.hidden) openChatHistoryPopover();
  else closeChatHistoryPopover();
}

export function showChatOptions() {
  if (!contextUsagePopover || !contextUsageBtn) return;
  openContextPopover();
}
