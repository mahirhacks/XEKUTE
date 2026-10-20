import { appState } from "../../core/app-state.js";
import {
  terminalTagQueryAt, fileTagQueryAt, topTerminalTagMatches, fileTagName, topContextTagMatches,
  projectChatsForTags, createFileTagChip, createChatTagChip, createTerminalTagChip,
} from "./file-tags.js";
import { chatInput, slashCommandSuggestions } from "../../core/dom-refs.js";
import { SetiIconTheme } from "../../core/runtime-globals.js";
import {
  chatSessions, closedChatSessions, archivedChatSessions, activeChatSession,
} from "./chat-sessions.js";
import { refreshDirMap } from "./prompt-context.js";
import { scoreQuickMatch } from "../../bootstrap.js";
import { onChatInputChange } from "./composer-input.js";

export function refreshTerminalsForTags(includeHistory = false) {
  window.clearTimeout(appState.terminalTagTimer);
  appState.terminalTagTimer = null;
  if (appState.terminalTagRefresh) { appState.terminalTagReloadHistory ||= includeHistory; return; }
  const workspace = appState.rootPath;
  if (appState.terminalTagCache.workspace !== workspace) appState.terminalTagCache = { workspace, items: [], history: [], loaded: false, error: "" };
  appState.terminalTagRefresh = Promise.resolve().then(() => window.api.terminalReferences({ workspace, includeHistory })).then(result => {
    if (appState.rootPath !== workspace) return;
    const incoming = result?.ok ? result.terminals || [] : [];
    const history = includeHistory ? incoming.filter(item => item.saved) : appState.terminalTagCache.history;
    const live = incoming.map(item => {
      const prior = item.processId && history.find(saved => saved.processId === item.processId);
      return prior ? { ...item, id: prior.id } : item;
    });
    const items = [...new Map([...history, ...live].map(item => [item.id, item])).values()]
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    appState.terminalTagCache = { workspace, items, history, loaded: true,
      error: result?.ok ? "" : "Could not load project terminals" };
  }).catch(() => {
    if (appState.rootPath === workspace) appState.terminalTagCache = { workspace, items: [], history: [], loaded: true, error: "Could not load project terminals" };
  }).finally(() => {
    appState.terminalTagRefresh = null;
    if (appState.fileTagTarget?.kind === "terminal") {
      renderFileTagSuggestions();
      if (appState.terminalTagReloadHistory) {
        appState.terminalTagReloadHistory = false;
        refreshTerminalsForTags(true);
      } else if (!appState.terminalTagRefresh && appState.fileTagTarget?.kind === "terminal") {
        appState.terminalTagTimer = window.setTimeout(refreshTerminalsForTags, 1000);
      }
    }
  });
}

export function fileTagProjectFiles() {
  if (appState.projectFilesForTags.source !== appState.dirMapCache) {
    appState.projectFilesForTags = { source: appState.dirMapCache, files: ToolParser.parseProjectFiles(appState.dirMapCache || "") };
  }
  return appState.projectFilesForTags.files;
}

export function fileTagQueryAtCaret() {
  const selection = window.getSelection?.();
  const node = selection?.anchorNode;
  if (!selection?.isCollapsed || node?.nodeType !== Node.TEXT_NODE || node.parentNode !== chatInput) return null;
  const before = node.data.slice(0, selection.anchorOffset);
  const found = fileTagQueryAt(before) || terminalTagQueryAt(before);
  return found && { ...found, node, end: selection.anchorOffset };
}

export function closeFileTagSuggestions() {
  appState.terminalTagReloadHistory = false;
  window.clearTimeout(appState.terminalTagTimer);
  appState.terminalTagTimer = null;
  if (appState.fileTagSuggestions) appState.fileTagSuggestions.hidden = true;
  appState.fileTagItems = [];
  appState.fileTagTarget = null;
  chatInput?.removeAttribute("aria-activedescendant");
  chatInput?.setAttribute("aria-expanded", "false");
}

export function fileTagSuggestionsElement() {
  if (appState.fileTagSuggestions) return appState.fileTagSuggestions;
  appState.fileTagSuggestions = document.createElement("div");
  appState.fileTagSuggestions.id = "file-tag-suggestions";
  appState.fileTagSuggestions.className = "file-tag-suggestions";
  appState.fileTagSuggestions.setAttribute("role", "listbox");
  appState.fileTagSuggestions.setAttribute("aria-label", "Project files and chats");
  appState.fileTagSuggestions.hidden = true;
  slashCommandSuggestions?.after(appState.fileTagSuggestions);
  return appState.fileTagSuggestions;
}

export function renderFileTagSuggestions({ revealSelection = false } = {}) {
  const found = appState.rootPath && chatInput && document.activeElement === chatInput ? fileTagQueryAtCaret() : null;
  if (!found) appState.fileTagDismissed = null;
  if (!found || (found.node === appState.fileTagDismissed?.node && found.start === appState.fileTagDismissed.start && found.kind === appState.fileTagDismissed.kind && found.query === appState.fileTagDismissed.query)) return closeFileTagSuggestions();
  const opening = !appState.fileTagTarget || found.kind !== appState.fileTagTarget.kind;
  const queryChanged = opening || found.query !== appState.fileTagTarget.query;
  const isTerminal = found.kind === "terminal";
  if (!isTerminal) window.clearTimeout(appState.terminalTagTimer);
  if (opening && !isTerminal && !appState.fileTagDirMapRefresh) {
    appState.fileTagDirMapRefresh = refreshDirMap().catch(() => {}).finally(() => {
      appState.fileTagDirMapRefresh = null;
      if (appState.fileTagTarget) renderFileTagSuggestions();
    });
  }
  if (queryChanged) appState.fileTagIndex = 0;
  appState.fileTagTarget = found;
  if (isTerminal && (opening || appState.terminalTagCache.workspace !== appState.rootPath)) refreshTerminalsForTags(true);
  const currentSession = activeChatSession();
  const chats = projectChatsForTags([...chatSessions, ...closedChatSessions, ...archivedChatSessions], currentSession?.memorySessionId || currentSession?.id,
    currentSession?.memoryProjectId);
  appState.fileTagItems = isTerminal ? topTerminalTagMatches(appState.terminalTagCache.workspace === appState.rootPath ? appState.terminalTagCache.items : [], found.query, scoreQuickMatch)
    : topContextTagMatches(fileTagProjectFiles(), chats, found.query, scoreQuickMatch);
  appState.fileTagIndex = Math.min(appState.fileTagIndex, Math.max(appState.fileTagItems.length - 1, 0));
  const list = fileTagSuggestionsElement();
  const previousScrollTop = list.scrollTop;
  list.setAttribute("aria-label", isTerminal ? "Project terminals" : "Project files and chats");
  list.replaceChildren();
  if (!appState.fileTagItems.length) {
    const empty = document.createElement("div");
    empty.className = "file-tag-empty";
    empty.setAttribute("role", "presentation");
    empty.textContent = isTerminal ? appState.terminalTagCache.error || (appState.terminalTagCache.loaded ? "No matching terminals" : "Loading project terminals…")
      : appState.dirMapCache ? "No matching files or chats" : "Loading project context…";
    list.appendChild(empty);
  }
  appState.fileTagItems.forEach((item, index) => {
    const isChat = item.kind === "chat";
    const terminal = item.kind === "terminal";
    const path = item.path || "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `file-tag-option${index === appState.fileTagIndex ? " selected" : ""}`;
    button.setAttribute("role", "option");
    button.id = `file-tag-option-${index}`;
    button.setAttribute("aria-selected", String(index === appState.fileTagIndex));
    button.title = terminal ? `${item.name}\n${item.cwd || ""}\n${item.command || ""}` : isChat ? `Chat: ${item.title}` : path;
    const fileName = terminal ? item.name : isChat ? item.title : fileTagName(path);
    const icon = document.createElement("span");
    icon.className = terminal ? `file-tag-icon terminal-tag-icon terminal-tag-${item.origin === "agent" ? "agent" : "user"}`
      : isChat ? "file-tag-icon chat-tag-icon" : "file-tag-icon seti-icon";
    if (!isChat && !terminal) {
      const info = SetiIconTheme.iconForFile(fileName);
      icon.textContent = info.glyph;
      icon.style.color = info.color;
    }
    icon.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "file-tag-name";
    name.textContent = fileName;
    const folder = document.createElement("span");
    folder.className = "file-tag-folder";
    folder.textContent = isChat ? "Chat" : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    button.append(icon, name);
    if (!terminal) button.append(folder);
    if (terminal && item.running) {
      const spinner = document.createElement("span");
      spinner.className = "terminal-tag-running";
      spinner.setAttribute("role", "img");
      spinner.setAttribute("aria-label", "Running");
      button.append(spinner);
    }
    button.addEventListener("mousedown", (event) => { event.preventDefault(); chooseFileTag(index); });
    list.appendChild(button);
  });
  list.hidden = false;
  chatInput.setAttribute("aria-controls", list.id);
  chatInput.setAttribute("aria-autocomplete", "list");
  chatInput.setAttribute("aria-expanded", "true");
  if (appState.fileTagItems.length) chatInput.setAttribute("aria-activedescendant", `file-tag-option-${appState.fileTagIndex}`);
  list.scrollTop = queryChanged ? 0 : previousScrollTop;
  if (queryChanged || revealSelection) list.querySelector(".file-tag-option.selected")?.scrollIntoView({ block: "nearest" });
}

export function chooseFileTag(index = appState.fileTagIndex) {
  const item = appState.fileTagItems[index];
  const target = appState.fileTagTarget;
  if (!item || !target?.node.isConnected) return false;
  const range = document.createRange();
  range.setStart(target.node, target.start);
  range.setEnd(target.node, target.end);
  range.deleteContents();
  const chip = item.kind === "terminal" ? createTerminalTagChip(document, item.id, item.name, item.origin)
    : item.kind === "chat" ? createChatTagChip(document, item.sessionId, item.title) : createFileTagChip(document, item.path);
  range.insertNode(chip);
  let after = chip.nextSibling;
  if (after?.nodeType !== Node.TEXT_NODE || !/^\s/.test(after.data)) {
    after = document.createTextNode(" ");
    chip.after(after);
  }
  window.getSelection()?.collapse(after, 1);
  closeFileTagSuggestions();
  onChatInputChange();
  return true;
}

export function adjacentFileTag(direction) {
  const selection = window.getSelection?.();
  const node = selection?.anchorNode;
  if (!selection?.isCollapsed || !node || !chatInput.contains(node)) return null;
  const inside = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node)?.closest?.(".file-tag-chip");
  if (inside) return inside;
  const offset = selection.anchorOffset;
  const step = (current) => (direction < 0 ? current.previousSibling : current.nextSibling);
  let sibling;
  if (node.nodeType === Node.TEXT_NODE) {
    if (direction < 0 ? offset > 0 : offset < node.data.length) return null;
    sibling = step(node);
  } else {
    sibling = node.childNodes[direction < 0 ? offset - 1 : offset];
  }
  while (sibling?.nodeType === Node.TEXT_NODE && !sibling.data) sibling = step(sibling);
  return sibling?.classList?.contains("file-tag-chip") ? sibling : null;
}

export function handleFileTagKeydown(e) {
  if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const chip = adjacentFileTag(e.key === "Backspace" ? -1 : 1);
    if (!chip) return false;
    const neighbor = e.key === "Backspace" ? chip.previousSibling : chip.nextSibling;
    chip.remove();
    if (neighbor?.nodeType === Node.TEXT_NODE) {
      window.getSelection()?.collapse(neighbor, e.key === "Backspace" ? neighbor.data.length : 0);
    }
    onChatInputChange();
    return true;
  }
  if (appState.fileTagSuggestions?.hidden !== false) return false;
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && appState.fileTagItems.length) {
    const direction = e.key === "ArrowDown" ? 1 : -1;
    appState.fileTagIndex = (appState.fileTagIndex + direction + appState.fileTagItems.length) % appState.fileTagItems.length;
    renderFileTagSuggestions({ revealSelection: true });
    return true;
  }
  if (e.key === "Tab" && !e.shiftKey) return chooseFileTag() || true;
  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) return chooseFileTag() || true;
  if (e.key === "Escape") {
    appState.fileTagDismissed = appState.fileTagTarget;
    closeFileTagSuggestions();
    return true;
  }
  return false;
}
