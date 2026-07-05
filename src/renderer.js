/* ── Renderer (runs in the browser context via contextBridge) ── */

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const btnNewFile       = $("btn-new-file");
const btnNewFolder     = $("btn-new-folder");
const explorerTitle    = $("explorer-title");
const btnOpenFolder    = $("btn-open-folder");
const fileTree         = $("file-tree");
const editorTabBar     = $("editor-tab-bar");
const editorEmpty      = $("editor-empty");
const editorView       = $("editor-view");
const editorError      = $("editor-error");
const messages         = $("messages");
const chatInput        = $("chat-input");
const chatInputMeasure = $("chat-input-measure");
const sendBtn          = $("send-btn");
const chatHeader       = $("chat-header");
const btnTopTerminal  = $("btn-top-terminal");
const btnTopChat      = $("btn-top-chat");
const btnWindowMinimize = $("btn-window-minimize");
const btnWindowMaximize = $("btn-window-maximize");
const btnWindowClose = $("btn-window-close");
const chatSessionSelect = $("chat-session-select");
const btnChatNew      = $("btn-chat-new");
const btnChatDelete   = $("btn-chat-delete");
const btnChatHistory  = $("btn-chat-history");
const btnChatMore     = $("btn-chat-more");
const btnChatCollapse = $("btn-chat-collapse");
const contextUsageBtn  = $("context-usage-btn");
const contextRingFill  = $("context-ring-fill");
const contextUsagePopover = $("context-usage-popover");
const contextUsageFill = $("context-usage-fill");
const contextUsageUsed = $("context-usage-used");
const contextUsageFree = $("context-usage-free");
const contextUsagePct  = $("context-usage-pct");
const modelPicker      = $("model-picker");
const modelLabel       = $("model-label");
const modelMenu        = $("model-menu");
const modelSearch      = $("model-search");
const modelList        = $("model-list");
const modelAddBtn      = $("model-add-btn");
const modelAddForm     = $("model-add-form");
const modelCustom      = $("model-custom");
const modelCustomAdd   = $("model-custom-add");
const modelEditMenu    = $("model-edit-menu");
const thinkingToggle   = $("thinking-toggle");
const contextOptions   = $("context-options");
const sidebar          = $("sidebar");
const sidebarResize    = $("sidebar-resize");
const chatPane         = $("chat-pane");
const chatResize       = $("chat-resize");
const terminalPane     = $("terminal-pane");
const terminalResize   = $("terminal-resize");
const centerPanel      = $("center-panel");
const editorPane       = $("editor-pane");

const TERMINAL_HEADER_H = 35;
const TERMINAL_MIN_EXPANDED = 80;
const EDITOR_MIN_HEIGHT = 120;
let terminalSavedHeight = 220;
let terminalCollapsed = false;
let chatCollapsed = false;
const statusLnCol      = $("status-ln-col");
const statusOllamaPort = $("status-ollama-port");

const OLLAMA_PORT = 11434;

// ── State ─────────────────────────────────────────────────────────────────────
let rootPath     = null;
let dirMapCache  = "";
let selectedItem = null;
let chatHistory  = [];
let streaming    = false;
let stopRequested = false;
let activeStreamContent = "";
let contextFilesCache = [];
let chatSessionCounter = 0;
let activeChatSessionId = "";
const chatSessions = [];

const CONTEXT_RING_R = 8;
const CONTEXT_RING_C = 2 * Math.PI * CONTEXT_RING_R;

/** @type {Map<string, { path: string, diskPath: string, name: string, content: string | null, savedContent: string, dirty: boolean, error: string | null }>} */
const openTabs      = new Map();
let activeTabPath   = null;
let editorLoadedPath = null;

let selectedModel = localStorage.getItem("pointer:model") || "";
let allModels     = [];
let editingModel  = null;
let modelLoadSeq  = 0;
let modelLoadInFlight = null;

const CONTEXT_OPTIONS = ["4K", "8K", "16K", "32K", "64K", "128K", "256K"];
const MODEL_SETTINGS_KEY = "pointer:modelSettings";
const WORKSPACE_KEY = "pointer:workspace";

function createChatSession(title = "New Agent") {
  const id = `chat-${Date.now()}-${++chatSessionCounter}`;
  return {
    id,
    title,
    history: [],
    contextFilesCache: [],
    messagesHtml: "",
    activeStreamContent: "",
  };
}

function activeChatSession() {
  return chatSessions.find((session) => session.id === activeChatSessionId) || null;
}

function setChatCollapsed(collapsed) {
  chatCollapsed = collapsed;
  chatPane?.classList.toggle("collapsed", collapsed);
  chatResize?.classList.toggle("collapsed", collapsed);
  btnTopChat?.classList.toggle("active", !collapsed);
  btnTopChat?.classList.toggle("inactive", collapsed);
  if (!collapsed) {
    requestAnimationFrame(() => {
      resizeChatInput();
      chatInput?.focus();
    });
  }
}

function ensureChatSession() {
  if (activeChatSession()) return activeChatSession();
  const session = createChatSession("New Agent");
  chatSessions.push(session);
  activeChatSessionId = session.id;
  chatHistory = session.history;
  contextFilesCache = session.contextFilesCache;
  activeStreamContent = "";
  messages.innerHTML = "";
  return session;
}

function openChatPane({ createIfEmpty = true } = {}) {
  if (createIfEmpty) ensureChatSession();
  setChatCollapsed(false);
  renderChatSessionSelect();
  updateContextUsage();
}

function syncActiveChatSession() {
  const session = activeChatSession();
  if (!session) return;
  session.history = chatHistory;
  session.contextFilesCache = contextFilesCache;
  session.activeStreamContent = activeStreamContent;
  session.messagesHtml = messages?.innerHTML || "";
}

function renderChatSessionSelect() {
  if (!chatSessionSelect) return;
  chatSessionSelect.innerHTML = "";
  chatSessionSelect.classList.toggle("disabled", streaming || !chatSessions.length);

  chatSessions.forEach((session) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `chat-session-tab${session.id === activeChatSessionId ? " active" : ""}`;
    tab.dataset.sessionId = session.id;
    tab.title = session.title || "New Agent";

    const icon = document.createElement("span");
    icon.className = "codicon codicon-comment-discussion chat-title-icon";

    const label = document.createElement("span");
    label.className = "chat-session-label";
    label.textContent = session.title || "New Agent";

    const close = document.createElement("span");
    close.className = "codicon codicon-close chat-tab-close";
    close.dataset.closeSession = session.id;
    close.title = "Delete chat";

    tab.appendChild(icon);
    tab.appendChild(label);
    tab.appendChild(close);
    chatSessionSelect.appendChild(tab);
  });

  if (btnChatDelete) btnChatDelete.disabled = streaming;
  if (btnChatNew) btnChatNew.disabled = streaming;
}

function loadChatSession(id) {
  const session = chatSessions.find((item) => item.id === id);
  if (!session || streaming) {
    renderChatSessionSelect();
    return;
  }
  syncActiveChatSession();
  setChatCollapsed(false);
  activeChatSessionId = session.id;
  chatHistory = session.history;
  contextFilesCache = session.contextFilesCache;
  activeStreamContent = session.activeStreamContent || "";
  messages.innerHTML = session.messagesHtml || "";
  renderChatSessionSelect();
  updateContextUsage();
  scrollMessages();
}

function newChatSession() {
  if (streaming) return;
  syncActiveChatSession();
  const session = createChatSession("New Agent");
  chatSessions.push(session);
  activeChatSessionId = session.id;
  chatHistory = session.history;
  contextFilesCache = session.contextFilesCache;
  activeStreamContent = "";
  messages.innerHTML = "";
  setChatCollapsed(false);
  renderChatSessionSelect();
  updateContextUsage();
  chatInput.focus();
}

function deleteChatSession(id = activeChatSessionId) {
  if (streaming) return;
  const idx = chatSessions.findIndex((session) => session.id === id);
  if (idx >= 0) chatSessions.splice(idx, 1);
  if (!chatSessions.length) {
    activeChatSessionId = "";
    chatHistory = [];
    contextFilesCache = [];
    activeStreamContent = "";
    messages.innerHTML = "";
    setChatCollapsed(true);
    renderChatSessionSelect();
    updateContextUsage();
    return;
  }
  const next = chatSessions[Math.max(0, Math.min(idx, chatSessions.length - 1))];
  activeChatSessionId = next.id;
  chatHistory = next.history;
  contextFilesCache = next.contextFilesCache;
  activeStreamContent = next.activeStreamContent || "";
  messages.innerHTML = next.messagesHtml || "";
  setChatCollapsed(false);
  renderChatSessionSelect();
  updateContextUsage();
  chatInput.focus();
}

function deleteActiveChatSession() {
  deleteChatSession(activeChatSessionId);
}

function openChatHistoryPicker() {
  if (streaming || !chatSessionSelect) return;
  setChatCollapsed(false);
  if (chatSessions.length <= 1) return;
  const idx = chatSessions.findIndex((session) => session.id === activeChatSessionId);
  const next = chatSessions[(idx + 1) % chatSessions.length];
  if (next) loadChatSession(next.id);
}

function showChatOptions() {
  if (!contextUsagePopover || !contextUsageBtn) return;
  openContextPopover();
}

function maybeNameActiveChat(text) {
  const session = activeChatSession();
  if (!session || session.history.length > 1) return;
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return;
  session.title = clean.length > 28 ? `${clean.slice(0, 27)}...` : clean;
  renderChatSessionSelect();
}

chatSessions.push(createChatSession("New Agent"));
activeChatSessionId = chatSessions[0].id;
chatHistory = chatSessions[0].history;
contextFilesCache = chatSessions[0].contextFilesCache;

function loadModelSettings() {
  try {
    const raw = localStorage.getItem(MODEL_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    localStorage.removeItem(MODEL_SETTINGS_KEY);
    return {};
  }
}

let modelSettings = loadModelSettings();

function getModelSettings(name) {
  if (!modelSettings[name]) {
    modelSettings[name] = { thinking: false, context: "32K" };
  }
  return modelSettings[name];
}

function saveModelSettings() {
  localStorage.setItem(MODEL_SETTINGS_KEY, JSON.stringify(modelSettings));
}

function setModelSetting(name, key, value) {
  getModelSettings(name)[key] = value;
  saveModelSettings();
  if (name === selectedModel && key === "context") updateContextUsage();
}

function contextToTokens(label) {
  const map = {
    "4K": 4096, "8K": 8192, "16K": 16384, "32K": 32768,
    "64K": 65536, "128K": 131072, "256K": 262144,
  };
  return map[label] ?? 32768;
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function estimateMessagesTokens(msgs) {
  return msgs.reduce((sum, m) => {
    let t = estimateTokens(m.content || "") + 4;
    if (m.tool_calls?.length) {
      t += estimateTokens(JSON.stringify(m.tool_calls));
    }
    if (m.tool_name) t += estimateTokens(m.tool_name) + 2;
    return sum + t;
  }, 0);
}

function formatTokenCount(n) {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(n);
}

function getContextUsage() {
  const settings = selectedModel ? getModelSettings(selectedModel) : { context: "32K" };
  const total = contextToTokens(settings.context);
  const draft = chatInput.value.trim();
  let used = estimateMessagesTokens(buildMessagesForApi());
  used += estimateTokens(JSON.stringify(ToolParser.OLLAMA_TOOLS));
  if (draft) used += estimateTokens(draft) + 4;
  if (activeStreamContent) used += estimateTokens(activeStreamContent) + 4;
  const pct = total > 0 ? Math.min(used / total, 1) : 0;
  return {
    total,
    used,
    free: Math.max(total - used, 0),
    pct,
    contextLabel: settings.context,
  };
}

function updateContextUsage() {
  if (!contextRingFill) return;
  const { total, used, free, pct } = getContextUsage();
  const filled = pct * CONTEXT_RING_C;

  contextRingFill.style.strokeDasharray = `${filled} ${CONTEXT_RING_C}`;
  contextUsageBtn.classList.toggle("warn", pct >= 0.75 && pct < 0.9);
  contextUsageBtn.classList.toggle("full", pct >= 0.9);

  if (contextUsageFill) {
    contextUsageFill.style.width = `${pct * 100}%`;
    contextUsageFill.classList.toggle("warn", pct >= 0.75 && pct < 0.9);
    contextUsageFill.classList.toggle("full", pct >= 0.9);
  }
  if (contextUsageUsed) contextUsageUsed.textContent = `${formatTokenCount(used)} used`;
  if (contextUsageFree) contextUsageFree.textContent = `${formatTokenCount(free)} free`;
  if (contextUsagePct) {
    contextUsagePct.textContent = `${Math.round(pct * 100)}% used · ${formatTokenCount(total)} max`;
  }
}

function positionContextPopover() {
  if (!contextUsagePopover || !contextUsageBtn) return;
  const rect = contextUsageBtn.getBoundingClientRect();
  const popH = contextUsagePopover.offsetHeight || 100;
  const popW = contextUsagePopover.offsetWidth || 240;
  let top = rect.top - popH - 8;
  let left = rect.right - popW;

  if (top < 8) top = rect.bottom + 8;
  if (left < 8) left = 8;
  if (left + popW > window.innerWidth - 8) {
    left = window.innerWidth - popW - 8;
  }

  contextUsagePopover.style.top = `${top}px`;
  contextUsagePopover.style.left = `${left}px`;
}

function closeContextPopover() {
  if (!contextUsagePopover) return;
  contextUsagePopover.hidden = true;
  contextUsageBtn?.classList.remove("active");
  contextUsageBtn?.setAttribute("aria-expanded", "false");
}

function openContextPopover() {
  closeModelMenu();
  updateContextUsage();
  contextUsagePopover.hidden = false;
  contextUsageBtn.classList.add("active");
  contextUsageBtn.setAttribute("aria-expanded", "true");
  positionContextPopover();
}

function toggleContextPopover() {
  if (contextUsagePopover.hidden) openContextPopover();
  else closeContextPopover();
}

function setExplorerActionsEnabled(enabled) {
  btnNewFile.disabled = !enabled;
  btnNewFolder.disabled = !enabled;
}

setExplorerActionsEnabled(false);

btnNewFile.addEventListener("click", () => createNewItemInput(false));
btnNewFolder.addEventListener("click", () => createNewItemInput(true));

let creatingItem = false;
async function createNewItemInput(isFolder) {
  if (!rootPath || creatingItem) return;
  creatingItem = true;

  let targetDir = rootPath;
  let targetContainer = fileTree;
  let paddingLeft = "8px";

  // If an item is highlighted, contextualize where to add the new element
  if (selectedItem) {
    const isDir = selectedItem.dataset.isDir === "true";
    if (isDir) {
      targetDir = selectedItem.dataset.path;
      const childrenContainer = selectedItem.nextElementSibling;
      
      // Auto-expand directory exactly like VS Code
      const chevron = selectedItem.querySelector(".tree-chevron");
      const icon = selectedItem.querySelector(".tree-icon");
      if (chevron) chevron.classList.add("expanded");
      if (icon) icon.className = "tree-icon codicon codicon-folder-opened";
      if (childrenContainer) childrenContainer.style.display = "block";
      
      // Force directory load if it hasn't been cached/expanded yet
      if (childrenContainer && (childrenContainer.childElementCount === 0 || (childrenContainer.children.length === 1 && childrenContainer.children[0].textContent === "Loading…"))) {
        const currentDepth = (parseInt(selectedItem.style.paddingLeft) - 8) / 8;
        childrenContainer.innerHTML = "";
        await renderTree(targetDir, childrenContainer, currentDepth + 1);
      }
      
      targetContainer = childrenContainer;
      paddingLeft = `${parseInt(selectedItem.style.paddingLeft) + 8}px`;
    } else {
      // If a file is selected, create adjacent to it inside its parent folder
      const filePath = selectedItem.dataset.path;
      const lastIdx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
      targetDir = filePath.substring(0, lastIdx);
      targetContainer = selectedItem.parentElement;
      paddingLeft = selectedItem.style.paddingLeft;
    }
  }

  // Generate the temporary tree input node
  const inputRow = document.createElement("div");
  inputRow.className = "tree-item tree-input-row";
  inputRow.style.paddingLeft = paddingLeft;

  const chevron = document.createElement("span");
  chevron.className = isFolder ? "tree-chevron codicon codicon-chevron-right" : "tree-chevron codicon hidden";

  const icon = document.createElement("span");
  icon.className = `tree-icon codicon ${isFolder ? "codicon-folder" : "codicon-file"}`;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tree-input";

  inputRow.appendChild(chevron);
  inputRow.appendChild(icon);
  inputRow.appendChild(input);

  // Prepend row to top of target directory view
  if (targetContainer.firstChild) {
    targetContainer.insertBefore(inputRow, targetContainer.firstChild);
  } else {
    targetContainer.appendChild(inputRow);
  }

  input.focus();

  let finished = false;
  async function commit() {
    if (finished) return;
    finished = true;
    const name = input.value.trim();
    if (!name) {
      inputRow.remove();
      creatingItem = false;
      return;
    }

    const separator = targetDir.includes("\\") ? "\\" : "/";
    const newPath = targetDir + (targetDir.endsWith(separator) ? "" : separator) + name;

    let result;
    if (isFolder) {
      result = await window.api.mkdir(newPath);
    } else {
      result = await window.api.writeFile(newPath, "");
    }

    if (result && result.error) {
      alert(`Error creating item: ${result.error}`);
      inputRow.remove();
    } else {
      // Re-render folder node to sync new additions sorted alphabetically
      if (targetContainer === fileTree) {
        await renderTree(rootPath, fileTree, 0);
      } else {
        const parentItem = targetContainer.previousElementSibling;
        const parentDepth = (parseInt(parentItem.style.paddingLeft) - 8) / 8;
        await renderTree(targetDir, targetContainer, parentDepth + 1);
      }
      
      // If it's a file, automatically open and highlight it
      if (!isFolder) {
        await openFile(newPath, name);
        const items = targetContainer.querySelectorAll(".tree-item");
        for (const itemRow of items) {
          if (itemRow.dataset.path === newPath) {
            selectItem(itemRow);
            break;
          }
        }
      }
    }
    creatingItem = false;
  }

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      finished = true;
      inputRow.remove();
      creatingItem = false;
    }
  });

  input.addEventListener("blur", async () => {
    await commit();
  });
}

function normPath(p) {
  return p.replace(/\\/g, "/");
}

function projectName(folder) {
  return folder.replace(/[/\\]$/, "").split(/[/\\]/).pop() || folder;
}

function setProjectFolder(folder) {
  if (folder) {
    explorerTitle.textContent = projectName(folder).toUpperCase();
    explorerTitle.title = folder;
  } else {
    explorerTitle.textContent = "EXPLORER";
    explorerTitle.title = "";
  }
}

function squashAgentTurn(startIdx) {
  const tail = chatHistory.slice(startIdx + 1);
  if (!tail.length) return;

  const assistants = tail.filter((m) => m.role === "assistant" && (m.content || "").trim());
  const lastText = assistants.length
    ? assistants[assistants.length - 1].content.trim()
    : "";

  if (!lastText) return;

  chatHistory.splice(startIdx + 1, tail.length, { role: "assistant", content: lastText });
}

async function loadWorkspace(folder) {
  if (!folder) return false;

  const entries = await window.api.readdir(folder);
  if (entries.error) {
    localStorage.removeItem(WORKSPACE_KEY);
    return false;
  }

  rootPath = folder;
  localStorage.setItem(WORKSPACE_KEY, folder);
  setProjectFolder(folder);
  setExplorerActionsEnabled(true);
  TerminalManager.setCwd(folder);
  await renderTree(folder, fileTree, 0);
  await refreshDirMap();
  await TerminalManager.openWithProject(folder);
  updateContextUsage();
  return true;
}

async function restoreLastWorkspace() {
  const saved = localStorage.getItem(WORKSPACE_KEY);
  if (saved) await loadWorkspace(saved);
}

// ── File Explorer ─────────────────────────────────────────────────────────────

btnOpenFolder.addEventListener("click", openFolder);

async function openFolder() {
  const folder = await window.api.openFolder();
  if (!folder) return;
  await loadWorkspace(folder);
}

async function openFileDialog() {
  const filePath = await window.api.openFile();
  if (!filePath) return;
  const fileName = filePath.split(/[/\\]/).pop();
  await openFile(filePath, fileName);
}

window.api.onMenuAction((action) => {
  switch (action) {
    case "new-file":
      if (!rootPath) {
        alert("Open a folder first.");
        return;
      }
      createNewItemInput(false);
      break;
    case "new-folder":
      if (!rootPath) {
        alert("Open a folder first.");
        return;
      }
      createNewItemInput(true);
      break;
    case "open-file":
      openFileDialog();
      break;
    case "open-folder":
      openFolder();
      break;
    case "new-terminal":
      TerminalManager.createTerminalAndShow();
      break;
    case "clear-terminal":
      TerminalManager.clearActive();
      break;
    case "kill-terminal":
      TerminalManager.killTerminal();
      break;
    default:
      break;
  }
});

async function renderTree(dirPath, container, depth) {
  container.innerHTML = "";
  const entries = await window.api.readdir(dirPath);

  if (entries.error) {
    container.innerHTML = `<div class="tree-item dimmed">${entries.error}</div>`;
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = `tree-item ${entry.isDir ? "tree-dir" : "tree-file"}`;
    item.style.paddingLeft = `${depth * 8 + 8}px`;
    item.dataset.path  = entry.path;
    item.dataset.isDir = entry.isDir;

    const chevron = document.createElement("span");
    chevron.className = entry.isDir
      ? "tree-chevron codicon codicon-chevron-right"
      : "tree-chevron codicon hidden";

    const icon = document.createElement("span");
    icon.className = `tree-icon codicon ${entry.isDir ? "codicon-folder" : fileCodicon(entry.name)}`;

    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = entry.name;

    item.appendChild(chevron);
    item.appendChild(icon);
    item.appendChild(name);
    container.appendChild(item);

    if (entry.isDir) {
      const children = document.createElement("div");
      children.className = "tree-children";
      children.style.display = "none";
      container.appendChild(children);

      let expanded = false;

      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        selectItem(item);
        expanded = !expanded;
        chevron.classList.toggle("expanded", expanded);
        icon.className = `tree-icon codicon ${expanded ? "codicon-folder-opened" : "codicon-folder"}`;
        children.style.display = expanded ? "block" : "none";
        if (expanded && children.childElementCount === 0) {
          children.innerHTML = `<div class="tree-item dimmed" style="padding-left:${(depth + 1) * 8 + 24}px">Loading…</div>`;
          await renderTree(entry.path, children, depth + 1);
        }
      });
    } else {
      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        selectItem(item);
        await openFile(entry.path, entry.name);
      });
    }
  }
}

function selectItem(el) {
  if (selectedItem) selectedItem.classList.remove("selected");
  selectedItem = el;
  el.classList.add("selected");
}

// ── Tabs & Editor ─────────────────────────────────────────────────────────────

async function openFile(filePath, fileName) {
  const path = normPath(filePath);

  if (openTabs.has(path)) {
    switchToTab(path);
    return;
  }

  openTabs.set(path, {
    path,
    diskPath: filePath,
    name: fileName,
    content: null,
    savedContent: "",
    dirty: false,
    error: null,
  });
  renderTabs();
  switchToTab(path);
  renderEditor();

  const result = await window.api.readFile(filePath);
  const tab = openTabs.get(path);
  if (!tab) return;

  if (result.error) {
    tab.error = result.error;
    tab.content = null;
  } else {
    const text = result.content ?? "";
    tab.content = text;
    tab.savedContent = text;
    tab.dirty = false;
    tab.error = null;
  }

  if (activeTabPath === path) {
    renderEditor();
  }
}

function commitActiveTab() {
  if (!activeTabPath || !openTabs.has(activeTabPath)) return;
  const tab = openTabs.get(activeTabPath);
  if (tab.error || tab.content === null) return;
  tab.content = EditorManager.getValue(activeTabPath);
  tab.dirty = tab.content !== tab.savedContent;
}

function switchToTab(filePath) {
  if (!openTabs.has(filePath)) return;
  commitActiveTab();
  activeTabPath = filePath;
  editorLoadedPath = null;
  renderTabs();
  renderEditor();
}

async function saveActiveTab() {
  commitActiveTab();
  if (!activeTabPath) return;
  const tab = openTabs.get(activeTabPath);
  if (!tab || tab.error) return;
  if (!tab.dirty) {
    EditorManager.clearChangeDecorations(activeTabPath);
    return;
  }

  const result = await window.api.writeFile(tab.diskPath, tab.content);
  if (result.error) {
    editorError.textContent = result.error;
    editorError.hidden = false;
    EditorManager.clear();
    return;
  }

  tab.savedContent = tab.content;
  tab.dirty = false;
  EditorManager.clearChangeDecorations(activeTabPath);
  renderTabs();
}

function closeTab(filePath, e) {
  e?.stopPropagation();
  if (!openTabs.has(filePath)) return;

  if (filePath === activeTabPath) commitActiveTab();
  const tab = openTabs.get(filePath);
  if (tab?.dirty) {
    if (!confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) return;
  }

  const paths = [...openTabs.keys()];
  const idx = paths.indexOf(filePath);
  const wasActive = activeTabPath === filePath;
  EditorManager.disposeModel(filePath);
  openTabs.delete(filePath);

  if (wasActive) {
    editorLoadedPath = null;
    if (openTabs.size === 0) {
      activeTabPath = null;
    } else {
      const next = paths[idx + 1] ?? paths[idx - 1];
      activeTabPath = openTabs.has(next) ? next : [...openTabs.keys()][0];
    }
  }

  renderTabs();
  renderEditor();
}

function renderTabs() {
  editorTabBar.innerHTML = "";

  for (const [path, tab] of openTabs) {
    const el = document.createElement("div");
    el.className = "editor-tab" + (path === activeTabPath ? " active" : "");
    el.title = tab.name;
    el.addEventListener("click", () => switchToTab(path));

    const icon = document.createElement("span");
    icon.className = `tab-icon codicon ${fileCodicon(tab.name)}`;

    const label = document.createElement("span");
    label.className = "tab-label" + (tab.dirty ? " tab-dirty" : "");
    label.textContent = tab.name;

    const close = document.createElement("button");
    close.className = "tab-close";
    close.title = "Close";
    close.innerHTML = '<span class="codicon codicon-close"></span>';
    close.addEventListener("click", (e) => closeTab(path, e));

    el.appendChild(icon);
    el.appendChild(label);
    el.appendChild(close);
    editorTabBar.appendChild(el);
  }
}

function updateTabDirtyIndicator() {
  const idx = [...openTabs.keys()].indexOf(activeTabPath);
  const tabEl = editorTabBar.children[idx];
  const tab = openTabs.get(activeTabPath);
  tabEl?.querySelector(".tab-label")?.classList.toggle("tab-dirty", !!tab?.dirty);
}

async function renderEditor() {
  if (!activeTabPath || !openTabs.has(activeTabPath)) {
    editorEmpty.removeAttribute("hidden");
    editorView.setAttribute("hidden", "");
    editorLoadedPath = null;
    EditorManager.clear();
    return;
  }

  const tab = openTabs.get(activeTabPath);
  editorEmpty.setAttribute("hidden", "");
  editorView.removeAttribute("hidden");

  if (tab.content === null && !tab.error) {
    editorError.hidden = true;
    editorLoadedPath = null;
    await EditorManager.showTab(activeTabPath, tab.name, "", { loading: true });
    return;
  }

  if (tab.error) {
    editorError.hidden = false;
    editorError.textContent = tab.error;
    editorLoadedPath = null;
    EditorManager.clear();
    return;
  }

  editorError.hidden = true;
  const text = tab.content ?? "";

  if (editorLoadedPath !== activeTabPath) {
    await EditorManager.showTab(activeTabPath, tab.name, text);
    editorLoadedPath = activeTabPath;
  }
}

EditorManager.setOnChange((path) => {
  if (path !== activeTabPath) return;
  const tab = openTabs.get(path);
  if (!tab || tab.error) return;
  tab.content = EditorManager.getValue(path);
  tab.dirty = tab.content !== tab.savedContent;
  updateTabDirtyIndicator();
});

EditorManager.setOnSave(() => saveActiveTab());

statusOllamaPort.textContent = `Ollama :${OLLAMA_PORT}`;
EditorManager.setOnCursorChange((pos) => {
  statusLnCol.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
});

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fileCodicon(name) {
  const ext = name.split(".").pop().toLowerCase();
  const map = {
    js: "codicon-file-code", ts: "codicon-file-code", jsx: "codicon-file-code", tsx: "codicon-file-code",
    json: "codicon-json", md: "codicon-markdown", css: "codicon-file-code", html: "codicon-file-code",
    py: "codicon-file-code", rs: "codicon-file-code", go: "codicon-file-code", rb: "codicon-file-code",
    sh: "codicon-terminal", yml: "codicon-file-code", yaml: "codicon-file-code",
    toml: "codicon-file-code", lock: "codicon-lock", gitignore: "codicon-exclude",
    png: "codicon-file-media", jpg: "codicon-file-media", jpeg: "codicon-file-media", svg: "codicon-file-media",
    gif: "codicon-file-media", ico: "codicon-file-media",
    pdf: "codicon-file-pdf",
  };
  return map[ext] ?? "codicon-file";
}

// ── Model picker ──────────────────────────────────────────────────────────────

function syncModelLabel() {
  if (!modelLabel) return;
  modelLabel.textContent = selectedModel || "Select model";
  if (modelPicker) {
    modelPicker.title = selectedModel ? `Model: ${selectedModel}` : "Select model";
  }
  updateContextUsage();
}

const CHAT_INPUT_MAX_LINES = 12;

function getChatInputMetrics() {
  if (!chatInput) return { line: 20, padTop: 12, padBot: 0 };
  const style = getComputedStyle(chatInput);
  let line = parseFloat(style.lineHeight);
  if (!Number.isFinite(line)) {
    line = parseFloat(style.fontSize) * 1.5;
  }
  return {
    line,
    padTop: parseFloat(style.paddingTop) || 0,
    padBot: parseFloat(style.paddingBottom) || 0,
  };
}

function syncChatInputMeasureStyles() {
  if (!chatInput || !chatInputMeasure) return;
  const style = getComputedStyle(chatInput);
  chatInputMeasure.style.width = `${chatInput.clientWidth}px`;
  chatInputMeasure.style.font = style.font;
  chatInputMeasure.style.fontFamily = style.fontFamily;
  chatInputMeasure.style.fontSize = style.fontSize;
  chatInputMeasure.style.fontWeight = style.fontWeight;
  chatInputMeasure.style.letterSpacing = style.letterSpacing;
  chatInputMeasure.style.lineHeight = style.lineHeight;
  chatInputMeasure.style.paddingTop = style.paddingTop;
  chatInputMeasure.style.paddingRight = style.paddingRight;
  chatInputMeasure.style.paddingBottom = style.paddingBottom;
  chatInputMeasure.style.paddingLeft = style.paddingLeft;
}

function getChatInputMaxHeight() {
  const { line, padTop, padBot } = getChatInputMetrics();
  return Math.ceil(padTop + padBot + line * CHAT_INPUT_MAX_LINES);
}

function getChatInputDefaultHeight() {
  const { line, padTop, padBot } = getChatInputMetrics();
  return Math.ceil(padTop + padBot + line);
}

function resizeChatInput() {
  if (!chatInput) return;
  const maxH = getChatInputMaxHeight();
  const minH = getChatInputDefaultHeight();
  let contentH = 0;

  if (chatInputMeasure) {
    syncChatInputMeasureStyles();
    let measureText = chatInput.value || " ";
    if (measureText.endsWith("\n")) measureText += " ";
    chatInputMeasure.textContent = measureText;
    contentH = chatInputMeasure.scrollHeight;
  }

  chatInput.style.maxHeight = `${maxH}px`;
  chatInput.style.height = "0px";
  const scrollH = Math.max(contentH, chatInput.scrollHeight);
  const next = Math.min(Math.max(scrollH, minH), maxH);
  chatInput.style.height = `${next}px`;
  const atCap = scrollH > maxH;
  chatInput.style.overflowY = atCap ? "auto" : "hidden";
  chatInput.classList.toggle("at-scroll-cap", atCap);
}

function resetChatInput() {
  if (!chatInput) return;
  chatInput.value = "";
  chatInput.style.overflowY = "hidden";
  chatInput.classList.remove("at-scroll-cap");
  chatInput.style.height = `${getChatInputDefaultHeight()}px`;
  resizeChatInput();
}

function positionModelMenu() {
  if (!modelPicker || !modelMenu) return;
  const rect = modelPicker.getBoundingClientRect();
  const menuW = modelMenu.offsetWidth || 280;
  const menuH = modelMenu.offsetHeight || 320;
  const pad = 8;
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;

  let top = rect.top - menuH - pad;
  if (top < pad) top = rect.bottom + pad;
  if (top + menuH > viewportH - pad) {
    top = Math.max(pad, viewportH - menuH - pad);
  }

  let left = rect.left;
  if (left + menuW > viewportW - pad) {
    left = viewportW - menuW - pad;
  }
  if (left < pad) left = pad;

  modelMenu.style.top = `${top}px`;
  modelMenu.style.left = `${left}px`;
}

function closeModelEditMenu() {
  modelEditMenu.hidden = true;
  editingModel = null;
  modelList.querySelectorAll(".model-item.editing").forEach((el) => {
    el.classList.remove("editing");
  });
}

function closeModelMenu() {
  modelMenu.hidden = true;
  modelMenu.style.visibility = "";
  modelPicker.classList.remove("open");
  modelAddForm.hidden = true;
  modelSearch.value = "";
  closeModelEditMenu();
  closeContextPopover();
  renderModelList();
}

function positionModelEditMenu(anchorEl) {
  if (!anchorEl) return;
  modelEditMenu.hidden = false;
  const mainRect = modelMenu.getBoundingClientRect();
  const anchorRect = anchorEl.getBoundingClientRect();
  const menuW = modelEditMenu.offsetWidth || 200;
  const menuH = modelEditMenu.offsetHeight || 280;

  let left = mainRect.left - menuW - 6;
  let top = anchorRect.top;

  if (left < 8) left = mainRect.right + 6;
  if (top + menuH > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - menuH - 8);
  }

  modelEditMenu.style.left = `${left}px`;
  modelEditMenu.style.top = `${top}px`;
}

function openModelEditMenu(modelName, rowEl) {
  if (!modelEditMenu || !thinkingToggle || !contextOptions) return;
  editingModel = modelName;
  modelList.querySelectorAll(".model-item.editing").forEach((el) => {
    el.classList.remove("editing");
  });
  rowEl.classList.add("editing");

  const settings = getModelSettings(modelName);
  thinkingToggle.classList.toggle("on", settings.thinking);
  thinkingToggle.setAttribute("aria-pressed", String(settings.thinking));
  renderContextOptions(settings.context);

  requestAnimationFrame(() => positionModelEditMenu(rowEl));
}

function renderContextOptions(selected) {
  contextOptions.innerHTML = "";
  for (const opt of CONTEXT_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "context-option" + (opt === selected ? " selected" : "");
    btn.innerHTML = `<span>${opt}</span><span class="codicon codicon-check"></span>`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!editingModel) return;
      setModelSetting(editingModel, "context", opt);
      renderContextOptions(opt);
    });
    contextOptions.appendChild(btn);
  }
}

thinkingToggle?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!editingModel) return;
  const settings = getModelSettings(editingModel);
  settings.thinking = !settings.thinking;
  saveModelSettings();
  thinkingToggle.classList.toggle("on", settings.thinking);
  thinkingToggle.setAttribute("aria-pressed", String(settings.thinking));
});

function showModelListLoading() {
  modelList.innerHTML = `<div class="model-list-empty">Loading models…</div>`;
}

function setModelListMessage(message) {
  if (!modelList) return;
  modelList.innerHTML = `<div class="model-list-empty">${escapeHtml(message)}</div>`;
}

function normalizeModelNames(models) {
  return [...new Set((models || []).filter(Boolean).map(String))].sort();
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function applyOllamaListResult(result) {
  if (result?.host && statusOllamaPort) {
    statusOllamaPort.textContent = `Ollama :${result.host}`;
  }

  if (!result || result.error) {
    allModels = normalizeModelNames(selectedModel ? [selectedModel] : []);
    if (allModels.length) {
      renderModelList();
    } else if (modelList) {
      setModelListMessage(result?.error || "Failed to load models");
    }
    return;
  }

  allModels = normalizeModelNames(result.models);
  const custom = selectedModel && !allModels.includes(selectedModel) ? [selectedModel] : [];
  allModels = normalizeModelNames([...custom, ...allModels]);
  if (!selectedModel && allModels.length) {
    selectedModel = allModels[0];
    localStorage.setItem("pointer:model", selectedModel);
  }
  renderModelList();
}

async function loadModels({ showLoading = true } = {}) {
  const seq = ++modelLoadSeq;
  syncModelLabel();
  if (showLoading) showModelListLoading();

  if (!window.api?.listModels) {
    allModels = normalizeModelNames(selectedModel ? [selectedModel] : []);
    if (allModels.length) renderModelList();
    else setModelListMessage("App bridge not ready. Restart the app.");
    return;
  }

  try {
    if (!modelLoadInFlight) {
      modelLoadInFlight = withTimeout(
        window.api.listModels(),
        9000,
        "Ollama model loading timed out.",
      ).finally(() => {
        modelLoadInFlight = null;
      });
    }
    const result = await modelLoadInFlight;
    if (seq !== modelLoadSeq) return;
    applyOllamaListResult(result);
  } catch (err) {
    if (seq !== modelLoadSeq) return;
    allModels = normalizeModelNames(selectedModel ? [selectedModel] : []);
    if (allModels.length) renderModelList();
    else setModelListMessage(err.message || "Failed to load models");
  } finally {
    if (seq !== modelLoadSeq) return;
    syncModelLabel();
    if (!modelMenu.hidden) positionModelMenu();
  }
}

function renderModelList() {
  const query = modelSearch.value.trim().toLowerCase();
  const filtered = allModels.filter((m) => m.toLowerCase().includes(query));

  modelList.innerHTML = "";
  if (!filtered.length) {
    modelList.innerHTML = `<div class="model-list-empty">${query ? "No models match your search" : "No models found"}</div>`;
    return;
  }

  for (const name of filtered) {
    const row = document.createElement("div");
    row.className = "model-item" + (name === selectedModel ? " selected" : "");
    row.dataset.model = name;

    const nameEl = document.createElement("span");
    nameEl.className = "model-item-name";
    nameEl.textContent = name;

    const trailing = document.createElement("div");
    trailing.className = "model-item-trailing";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "model-edit-btn";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (editingModel === name && !modelEditMenu.hidden) {
        closeModelEditMenu();
      } else {
        openModelEditMenu(name, row);
      }
    });

    const check = document.createElement("span");
    check.className = "codicon codicon-check";

    trailing.appendChild(editBtn);
    trailing.appendChild(check);
    row.appendChild(nameEl);
    row.appendChild(trailing);

    row.addEventListener("click", () => {
      selectedModel = name;
      localStorage.setItem("pointer:model", selectedModel);
      syncModelLabel();
      renderModelList();
      updateContextUsage();
      closeModelMenu();
    });

    modelList.appendChild(row);
  }

  if (!modelMenu.hidden) {
    requestAnimationFrame(() => positionModelMenu());
  }
}

async function openModelMenu() {
  closeModelEditMenu();
  closeContextPopover();
  modelMenu.style.visibility = "hidden";
  modelMenu.hidden = false;
  modelPicker.classList.add("open");
  if (allModels.length) renderModelList();
  else showModelListLoading();
  positionModelMenu();
  modelMenu.style.visibility = "visible";
  await loadModels({ showLoading: !allModels.length });
  positionModelMenu();
  modelSearch.focus();
}

modelPicker.addEventListener("click", (e) => {
  e.stopPropagation();
  if (modelMenu.hidden) {
    openModelMenu();
  } else {
    closeModelMenu();
  }
});

modelMenu?.addEventListener("mousedown", (e) => e.stopPropagation());

modelSearch.addEventListener("input", renderModelList);
modelSearch.addEventListener("keydown", (e) => e.stopPropagation());

modelAddBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  modelAddForm.hidden = !modelAddForm.hidden;
  if (!modelAddForm.hidden) {
    modelCustom.focus();
    positionModelMenu();
  }
});

function addCustomModel() {
  const name = modelCustom.value.trim();
  if (!name) return;
  if (!allModels.includes(name)) {
    allModels.push(name);
    allModels.sort();
  }
  selectedModel = name;
  localStorage.setItem("pointer:model", selectedModel);
  modelCustom.value = "";
  modelAddForm.hidden = true;
  syncModelLabel();
  renderModelList();
  updateContextUsage();
  closeModelMenu();
}

modelCustomAdd.addEventListener("click", addCustomModel);
modelCustom.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") addCustomModel();
});

document.addEventListener("click", (e) => {
  if (modelMenu.hidden) return;
  const inMain = modelMenu.contains(e.target) || modelPicker.contains(e.target);
  const inEdit = modelEditMenu && !modelEditMenu.hidden && modelEditMenu.contains(e.target);
  if (!inMain && !inEdit) closeModelMenu();
});

window.addEventListener("resize", () => {
  resizeChatInput();
  if (!modelMenu.hidden) positionModelMenu();
  if (!contextUsagePopover.hidden) positionContextPopover();
  if (!modelEditMenu.hidden && editingModel) {
    const row = [...modelList.querySelectorAll(".model-item")].find(
      (el) => el.dataset.model === editingModel,
    );
    if (row) positionModelEditMenu(row);
  }
});

syncModelLabel();
loadModels();
updateContextUsage();

// ── Tools & system prompt ─────────────────────────────────────────────────────

async function refreshDirMap() {
  if (!rootPath) {
    dirMapCache = "";
    return;
  }
  const result = await window.api.dirMap(rootPath);
  dirMapCache = result.map || "";
}

function relativePathFromRoot(absPath) {
  if (!rootPath || !absPath) return null;
  const root = normPath(rootPath).replace(/\/$/, "");
  const file = normPath(absPath);
  if (file === root) return "";
  if (file.startsWith(`${root}/`)) return file.slice(root.length + 1);
  return null;
}

function getActiveFileContext() {
  if (!activeTabPath || !openTabs.has(activeTabPath)) return null;
  commitActiveTab();
  const tab = openTabs.get(activeTabPath);
  const rel = relativePathFromRoot(tab.path);
  if (!rel) return null;
  return { path: rel, content: tab.content ?? "" };
}

async function readWorkspaceFile(relPath) {
  const result = await window.api.readFile(joinWorkspacePath(relPath));
  if (result.error || result.content == null) return null;
  return { path: relPath, content: result.content };
}

/** Load contents of project files mentioned in the user message (small models can't read minds). */
async function collectMentionedFiles(userMessage) {
  const files = [];
  if (!rootPath || !dirMapCache) return files;

  const projectFiles = ToolParser.parseProjectFiles(dirMapCache);
  const activePath = getActiveFileContext()?.path;
  const msg = (userMessage || "").toLowerCase();

  for (const rel of projectFiles) {
    if (files.length >= 3) break;
    if (rel === activePath) continue;
    const base = rel.split("/").pop().toLowerCase();
    if (!msg.includes(base) && !msg.includes(rel.toLowerCase())) continue;
    const file = await readWorkspaceFile(rel);
    if (file) files.push(file);
  }

  // Single-file project: always show it so the model can patch correctly.
  if (!files.length && projectFiles.length === 1 && projectFiles[0] !== activePath) {
    const file = await readWorkspaceFile(projectFiles[0]);
    if (file) files.push(file);
  }

  return files;
}

function buildMessagesForApi() {
  const system = ToolParser.buildSystemContext({
    dirMap: dirMapCache,
    activeFile: getActiveFileContext(),
    extraFiles: contextFilesCache,
  });
  return [{ role: "system", content: system }, ...chatHistory];
}

function renderMarkdown(el, md, { streaming = false } = {}) {
  if (globalThis.MarkdownRenderer) {
    if (streaming) {
      globalThis.MarkdownRenderer.scheduleRender(el, () => md, true);
    } else {
      globalThis.MarkdownRenderer.renderToElement(el, md);
    }
  } else {
    el.dataset.rawMd = md;
    el.textContent = md;
  }
}

function createToolCard(tool, { pending = false } = {}) {
  const card = document.createElement("div");
  card.className = `tool-card${pending ? " pending" : ""}`;
  const label = ToolMap.targetForTool(tool);
  card.dataset.file = label;
  const detail = ToolParser.toolCardDetail(tool);
  card.innerHTML = `
    <div class="tool-card-header">
      <span class="codicon codicon-file tool-card-icon"></span>
      <span class="tool-card-file">${escapeHtml(label)}</span>
      <span class="tool-card-badge">${escapeHtml(detail)}</span>
      <span class="tool-card-status running">${pending ? "Queued…" : "Working…"}</span>
    </div>
  `;
  return card;
}

function setToolCardStatus(card, type, message) {
  const status = card.querySelector(".tool-card-status");
  if (!status) return;
  status.className = `tool-card-status ${type}`;
  status.textContent = message;
}

function joinWorkspacePath(relPath) {
  if (!rootPath) return relPath;
  const sep = rootPath.includes("\\") ? "\\" : "/";
  return rootPath + sep + relPath.replace(/[/\\]/g, sep);
}

function toolCallForExecution(tool) {
  const name = tool.toolName || tool.action;
  const args = { ...(tool.args || {}) };

  if (tool.file) args.path = tool.file;
  if (tool.query) {
    args.query = tool.query;
    args.limit = tool.limit;
  }
  if (tool.command) {
    args.command = tool.command;
    args.timeout_ms = tool.timeoutMs;
  }
  if (tool.processId) args.id = tool.processId;
  if (tool.code != null) args.content = tool.code;
  if (tool.patches) {
    args.patches = tool.patches;
    if (tool.patches.length === 1) {
      args.search = tool.patches[0].search;
      args.replace = tool.patches[0].replace;
    }
  }

  return {
    id: tool.callId,
    type: "function",
    function: { name, arguments: args },
  };
}

async function applyEditToEditor(tool, newContent, previousContent = null) {
  if (newContent == null) return;

  const filePath = joinWorkspacePath(tool.file);
  const fileName = tool.file.split(/[/\\]/).pop();
  const tabPath = normPath(filePath);

  if (openTabs.has(tabPath)) {
    const tab = openTabs.get(tabPath);
    const before = previousContent ?? tab.content ?? tab.savedContent ?? "";
    tab.content = newContent;
    tab.savedContent = newContent;
    tab.dirty = false;
    tab.error = null;
    if (activeTabPath === tabPath) {
      await EditorManager.showTab(tabPath, fileName, newContent);
      EditorManager.showChangeDecorations(tabPath, before, newContent);
      editorLoadedPath = tabPath;
    }
    renderTabs();
  } else {
    const before = previousContent ?? "";
    await openFile(filePath, fileName);
    const tab = openTabs.get(tabPath);
    if (tab) {
      tab.content = newContent;
      tab.savedContent = newContent;
      tab.dirty = false;
    }
    if (activeTabPath === tabPath) {
      await EditorManager.showTab(tabPath, fileName, newContent);
      EditorManager.showChangeDecorations(tabPath, before, newContent);
      editorLoadedPath = tabPath;
    }
  }
}

async function executeTool(tool, turn, contentEl, editContext = {}) {
  const fileKey = ToolMap.targetForTool(tool);
  let card = turn.querySelector(`.tool-card[data-file="${CSS.escape(fileKey)}"]`);
  if (!card) {
    card = createToolCard(tool);
    turn.insertBefore(card, contentEl);
  } else {
    card.classList.remove("pending");
    setToolCardStatus(card, "running", "Working…");
  }

  if (!rootPath) {
    setToolCardStatus(card, "error", "No folder open");
    return { ok: false, error: "No folder open", toolName: tool.toolName || tool.action, content: "Error: No folder open" };
  }

  let execTool = { ...tool };
  if (
    !execTool.file
    && ["read_file", "write_file", "create_file", "patch_file", "replace_in_file", "insert_in_file", "append_file", "delete_file"].includes(execTool.action)
    && editContext.targetFile
  ) {
    execTool.file = editContext.targetFile;
    card.dataset.file = execTool.file;
    const fileEl = card.querySelector(".tool-card-file");
    if (fileEl) fileEl.textContent = execTool.file;
  }
  if (editContext.dirMap && tool.file && tool.action !== "write_file") {
    const file = ToolParser.resolveToolPath(tool.file, editContext);
    if (file !== tool.file) {
      execTool = { ...execTool, file };
      card.dataset.file = file;
      const fileEl = card.querySelector(".tool-card-file");
      if (fileEl) fileEl.textContent = file;
    }
  }

  let previousContent = null;
  if (execTool.file && ToolMap.isMutating(execTool) && execTool.action !== "delete_file") {
    const before = await readWorkspaceFile(execTool.file);
    previousContent = before?.content ?? "";
  }

  let result = await window.api.executeTool({
    workspace: rootPath,
    toolCall: toolCallForExecution(execTool),
  });

  if (tool.action !== "write_file" && result.error && /not found/i.test(result.error) && editContext.targetFile) {
    const retryFile = ToolParser.resolveToolPath(editContext.targetFile, editContext);
    if (retryFile && retryFile !== execTool.file) {
      execTool = { ...execTool, file: retryFile };
      card.dataset.file = retryFile;
      const fileEl = card.querySelector(".tool-card-file");
      if (fileEl) fileEl.textContent = retryFile;
      result = await window.api.executeTool({
        workspace: rootPath,
        toolCall: toolCallForExecution(execTool),
      });
    }
  }

  if (result.error) {
    // Rewrite raw errors into instructions the model can act on next round.
    let error = result.error;
    if (/file not found/i.test(error)) {
      error = `File ${execTool.file} does not exist. It is not in the project. Use write_file with the full content to create it first.`;
    } else if (/not found in file/i.test(error)) {
      error = `Patch failed: search text not found in ${execTool.file}. Call read_file on ${execTool.file}, copy the exact lines, then retry patch_file.`;
    }
    setToolCardStatus(card, "error", result.error);
    return { ...result, error, content: `Error: ${error}`, file: execTool.file };
  }

  const badge = card.querySelector(".tool-card-badge");
  if (badge) {
    badge.textContent = ToolParser.toolCardDetail(execTool);
  }

  setToolCardStatus(card, "success", ToolParser.formatToolSuccess(result));

  if (result.mode === "read" && result.file && result.content != null) {
    contextFilesCache = contextFilesCache.filter((f) => f.path !== result.file);
    contextFilesCache.push({ path: result.file, content: result.content });
  }

  if (result.mode === "delete" && result.file) {
    await refreshDirMap();
    await renderTree(rootPath, fileTree, 0);
    const tabPath = normPath(joinWorkspacePath(result.file));
    if (openTabs.has(tabPath)) closeTab(tabPath);
    contextFilesCache = contextFilesCache.filter((f) => f.path !== result.file);
  } else if (result.mutated || ["full", "create", "patch", "replace", "insert", "append", "noop"].includes(result.mode)) {
    await refreshDirMap();
    await renderTree(rootPath, fileTree, 0);
    if (result.file && result.content != null) {
      await applyEditToEditor({ ...execTool, file: result.file }, result.content, previousContent);
    }
  }

  // Keep cached context in sync so later rounds see the updated file, not a stale copy.
  if (result.file && result.content != null && ["full", "create", "patch", "replace", "insert", "append", "noop"].includes(result.mode)) {
    contextFilesCache = contextFilesCache.filter((f) => f.path !== result.file);
    contextFilesCache.push({ path: result.file, content: result.content });
  }

  syncActiveChatSession();
  scrollMessages();
  return { ...result, file: result.file || execTool.file };
}

function waitForOllamaRound(assistant, editContext) {
  return new Promise((resolve) => {
    let roundContent = "";
    let contentStarted = false;
    let abortedForRepetition = false;

    window.api.removeAllListeners("ollama:token");
    window.api.removeAllListeners("ollama:thinking");
    window.api.removeAllListeners("ollama:done");
    window.api.removeAllListeners("ollama:toolcall");

    window.api.onThinking((token) => {
      if (!contentStarted) assistant.setStatus("Thinking…");
      assistant.appendThinking(token);
    });

    window.api.onToolCall((calls) => {
      const tools = ToolParser.resolveTools(
        ToolParser.parseNativeToolCalls(calls),
        editContext,
      );
      for (const tool of tools) {
        const label = tool.file || tool.query || tool.command || tool.processId || tool.action || "";
        const exists = assistant.turn.querySelector(
          `.tool-card[data-file="${CSS.escape(label)}"]`,
        );
        if (!exists) {
          const card = createToolCard(tool, { pending: true });
          assistant.turn.insertBefore(card, assistant.contentEl);
          scrollMessages();
        }
      }
      if (tools.length === 1) {
        assistant.setStatus(ToolParser.toolStatusLabel(tools[0]));
      } else if (tools.length > 1) {
        assistant.setStatus(`Using ${tools.length} tools…`);
      }
    });

    window.api.onToken((token) => {
      if (abortedForRepetition) {
        roundContent += token;
        return;
      }
      const nextContent = roundContent + token;
      if (ToolParser.isRepetitiveLoop(nextContent)) {
        abortedForRepetition = true;
        roundContent = nextContent;
        if (!contentStarted) {
          contentStarted = true;
          assistant.finalizeThinking();
        }
        assistant.rawContent = "";
        assistant.contentEl.hidden = true;
        activeStreamContent = "";
        assistant.setStatus("Retrying with tool instructions...");
        window.api.abortChat?.();
        updateContextUsage();
        return;
      }
      if (!contentStarted) {
        contentStarted = true;
        assistant.finalizeThinking();
        assistant.clearStatus();
      }
      roundContent = nextContent;
      assistant.appendContent(token);
      activeStreamContent = assistant.rawContent;
      updateContextUsage();
    });

    window.api.onDone((payload) => {
      const text = roundContent || payload.fullText || "";
      if (!abortedForRepetition && !roundContent && payload.fullText) {
        const prev = assistant.rawContent.trim();
        assistant.rawContent = prev
          ? `${prev}\n\n${payload.fullText}`
          : payload.fullText;
        assistant.clearStatus();
        assistant.syncDisplay();
      }
      resolve({ ...payload, roundContent: text, abortedForRepetition });
    });
  });
}

async function requestOllamaChat(settings) {
  await refreshDirMap();
  const payload = {
    messages: buildMessagesForApi(),
    model: selectedModel,
    numCtx: contextToTokens(settings.context),
    thinking: settings.thinking,
    tools: ToolMap.TOOLS,
  };
  return window.api.chat(payload);
}

// ── Chat ──────────────────────────────────────────────────────────────────────

function scrollMessages() {
  messages.scrollTop = messages.scrollHeight;
}

function createThinkingTimer(metaEl) {
  const start = Date.now();
  const interval = setInterval(() => {
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    metaEl.textContent = `Thinking for ${secs}s`;
  }, 100);
  return {
    stop() {
      clearInterval(interval);
      const secs = ((Date.now() - start) / 1000).toFixed(1);
      metaEl.textContent = `Thought for ${secs}s`;
    },
  };
}

function addUserMessage(text) {
  const turn = document.createElement("div");
  turn.className = "chat-turn user";
  const box = document.createElement("div");
  box.className = "chat-box";
  const content = document.createElement("div");
  content.className = "chat-box-content";
  content.textContent = text;
  box.appendChild(content);
  turn.appendChild(box);
  messages.appendChild(turn);
  scrollMessages();
}

function addErrorMessage(text) {
  const turn = document.createElement("div");
  turn.className = "chat-turn error";
  const box = document.createElement("div");
  box.className = "chat-box chat-box-error";
  const content = document.createElement("div");
  content.className = "chat-box-content";
  content.textContent = text;
  box.appendChild(content);
  turn.appendChild(box);
  messages.appendChild(turn);
  syncActiveChatSession();
  scrollMessages();
}

function createAssistantTurn(enableThinking) {
  const turn = document.createElement("div");
  turn.className = "chat-turn assistant";

  let thinkingBlock = null;
  let thinkingBody = null;
  let thinkingMeta = null;
  let thinkingTimer = null;

  if (enableThinking) {
    thinkingBlock = document.createElement("div");
    thinkingBlock.className = "thinking-block collapsed";
    thinkingBlock.hidden = true;

    const header = document.createElement("button");
    header.type = "button";
    header.className = "thinking-header";
    header.innerHTML = `
      <span class="codicon codicon-chevron-right thinking-chevron"></span>
      <span class="thinking-title">Thinking</span>
      <span class="thinking-meta">Thinking…</span>
    `;

    thinkingBody = document.createElement("div");
    thinkingBody.className = "thinking-body";
    thinkingMeta = header.querySelector(".thinking-meta");

    header.addEventListener("click", () => {
      thinkingBlock.classList.toggle("collapsed");
      const chevron = header.querySelector(".thinking-chevron");
      chevron.classList.toggle("codicon-chevron-right", thinkingBlock.classList.contains("collapsed"));
      chevron.classList.toggle("codicon-chevron-down", !thinkingBlock.classList.contains("collapsed"));
    });

    thinkingBlock.appendChild(header);
    thinkingBlock.appendChild(thinkingBody);
    turn.appendChild(thinkingBlock);
  }

  const statusEl = document.createElement("div");
  statusEl.className = "assistant-status is-active";
  statusEl.textContent = "Planning…";
  turn.appendChild(statusEl);

  const contentEl = document.createElement("div");
  contentEl.className = "assistant-reply";
  contentEl.hidden = true;
  turn.appendChild(contentEl);
  messages.appendChild(turn);
  scrollMessages();

  const assistant = {
    turn,
    statusEl,
    contentEl,
    rawContent: "",
    rawThinking: "",
    thinkingBlock,
    thinkingBody,
    thinkingMeta,
    setStatus(text) {
      if (!this.statusEl) return;
      this.statusEl.textContent = text;
      this.statusEl.classList.add("is-active");
    },
    clearStatus() {
      if (!this.statusEl) return;
      this.statusEl.classList.remove("is-active");
    },
    displayContent() {
      const streaming = this.contentEl.classList.contains("streaming");
      return ToolParser.cleanReplyForDisplay(this.rawContent, { streaming });
    },
    syncDisplay() {
      const text = this.displayContent();
      if (text) {
        this.clearStatus();
        this.contentEl.hidden = false;
        renderMarkdown(
          this.contentEl,
          text,
          { streaming: this.contentEl.classList.contains("streaming") },
        );
      }
      scrollMessages();
    },
    appendContent(token) {
      this.rawContent += token;
      this.syncDisplay();
    },
    finalizeContent() {
      const text = this.displayContent();
      if (text) {
        this.contentEl.hidden = false;
        renderMarkdown(this.contentEl, text);
      } else if (this.rawContent.trim() && !ToolParser.isOnlyToolSyntax(this.rawContent)) {
        // Fallback: show raw text if cleaner stripped too aggressively
        this.contentEl.hidden = false;
        renderMarkdown(this.contentEl, this.rawContent.trim());
      } else {
        this.contentEl.hidden = true;
      }
      this.clearStatus();
    },
    startThinkingTimer() {
      if (!thinkingMeta || thinkingTimer) return;
      thinkingTimer = createThinkingTimer(thinkingMeta);
    },
    stopThinkingTimer() {
      if (!thinkingTimer) return;
      thinkingTimer.stop();
      thinkingTimer = null;
    },
    appendThinking(text) {
      if (!thinkingBody) return;
      if (thinkingBlock.hidden) {
        thinkingBlock.hidden = false;
        this.startThinkingTimer();
      }
      this.rawThinking += text;
      renderMarkdown(thinkingBody, this.rawThinking, { streaming: true });
      scrollMessages();
    },
    finalizeThinking() {
      this.stopThinkingTimer();
      if (thinkingBody) {
        renderMarkdown(thinkingBody, this.rawThinking);
      }
    },
  };

  return assistant;
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || streaming) return;

  if (!selectedModel) {
    addErrorMessage("Select a model before sending a message.");
    return;
  }

  chatInput.value = "";
  resetChatInput();
  addUserMessage(text);
  chatHistory.push({ role: "user", content: text });
  maybeNameActiveChat(text);
  syncActiveChatSession();

  const historyStart = chatHistory.length - 1;

  streaming = true;
  stopRequested = false;
  updateSendBtn();
  renderChatSessionSelect();
  activeStreamContent = "";
  await refreshDirMap();
  contextFilesCache = await collectMentionedFiles(text);
  syncActiveChatSession();
  updateContextUsage();

  const settings = getModelSettings(selectedModel);
  const assistant = createAssistantTurn(settings.thinking);
  assistant.contentEl.classList.add("streaming");

  const activeFile = getActiveFileContext();
  const editContext = {
    isEditRequest: ToolParser.isEditRequest(text),
    targetFile: ToolParser.inferEditTarget(text, activeFile, dirMapCache),
    activeFile,
    userMessage: text,
    dirMap: dirMapCache,
  };

  let executedTools = false;
  let completedEdit = false;
  let lastToolSummary = "";
  const toolLoopCounts = new Map();
  let noToolEditRetries = 0;

  try {
    for (let round = 0; round < ToolParser.MAX_AGENT_ROUNDS; round += 1) {
      if (round > 0) {
        activeStreamContent = assistant.rawContent;
        assistant.contentEl.classList.add("streaming");
        if (!assistant.rawContent.trim()) {
          assistant.contentEl.hidden = true;
        }
        assistant.setStatus("Planning…");
      }

      const donePromise = waitForOllamaRound(assistant, editContext);
      const result = await requestOllamaChat(settings);

      if (result.error) {
        assistant.turn.remove();
        addErrorMessage(result.error);
        chatHistory.splice(historyStart);
        syncActiveChatSession();
        return;
      }

      const payload = await donePromise;
      assistant.contentEl.classList.remove("streaming");
      assistant.finalizeThinking();

      if (assistant.thinkingBlock && !assistant.rawThinking) {
        assistant.thinkingBlock.hidden = true;
      }

      const rawRound = payload.roundContent || "";
      const roundText = ToolParser.cleanReplyForDisplay(rawRound);
      const tools = ToolParser.collectToolsFromResponse(rawRound, payload.toolCalls, editContext);
      const visibleRoundText = tools.length && editContext.isEditRequest ? "" : roundText;

      if ((payload.aborted || result.aborted) && stopRequested) {
        assistant.rawContent = assistant.displayContent().trim() || "Stopped.";
        assistant.finalizeContent();
        updateContextUsage();
        break;
      }

      if ((payload.abortedForRepetition || payload.aborted || result.aborted) && !tools.length) {
        if (editContext.isEditRequest && noToolEditRetries < 1) {
          noToolEditRetries += 1;
          assistant.rawContent = "";
          assistant.contentEl.hidden = true;
          assistant.setStatus("Retrying with tighter tool instructions...");
          chatHistory.push({
            role: "user",
            content: [
              "Your previous response repeated text and did not call tools.",
              "Do not write plans, function names, or code in chat.",
              "This is an edit request, so you must call tools now.",
              "Use read_file if needed, patch_file for existing files, and write_file for new files.",
              editContext.targetFile ? `Primary target file: ${editContext.targetFile}.` : "",
              `User request: ${editContext.userMessage}`,
            ].filter(Boolean).join(" "),
          });
          updateContextUsage();
          continue;
        }

        assistant.rawContent = "The model got stuck repeating text instead of using tools, so I stopped it before it filled the chat. Try a stronger tool-capable model or make the file names explicit.";
        assistant.finalizeContent();
        updateContextUsage();
        break;
      }

      if (!tools.length && ToolParser.isOnlyToolSyntax(rawRound)) {
        assistant.rawContent = "";
        assistant.finalizeContent();
        addErrorMessage("The model emitted malformed tool syntax instead of a usable tool call. Try again, or switch to a model with better tool support.");
        break;
      }

      const repeatedTool = tools.find((tool) => {
        const key = [
          tool.action,
          tool.file || "",
          tool.query || "",
          tool.command || "",
          tool.processId || "",
        ].join("\0");
        const next = (toolLoopCounts.get(key) || 0) + 1;
        toolLoopCounts.set(key, next);
        return next > 2;
      });

      if (repeatedTool) {
        assistant.rawContent = `The model repeated ${ToolParser.toolStatusLabel(repeatedTool).toLowerCase()} too many times, so I stopped the loop before it spammed the chat.`;
        assistant.finalizeContent();
        break;
      }

      if (!tools.length) {
        if (editContext.isEditRequest) {
          const asksClarifyingQuestion = /\?\s*$/.test(roundText.trim());

          if (completedEdit) {
            chatHistory.push({
              role: "assistant",
              content: roundText || lastToolSummary,
            });
            assistant.rawContent = roundText || lastToolSummary;
            assistant.finalizeContent();
            updateContextUsage();
            break;
          }

          if (!asksClarifyingQuestion && noToolEditRetries < 1) {
            noToolEditRetries += 1;
            assistant.rawContent = "";
            assistant.contentEl.hidden = true;
            assistant.setStatus("Retrying with tool instructions…");
            chatHistory.push({
              role: "user",
              content: [
                "You answered without changing files.",
                "This is an edit request, so text is not enough.",
                "Do not claim completion.",
                "Call the correct tool now: read_file if you need contents, then patch_file for an existing file or write_file for a new file.",
                editContext.targetFile ? `Target file: ${editContext.targetFile}` : "",
              ].filter(Boolean).join(" "),
            });
            updateContextUsage();
            continue;
          }

          if (!asksClarifyingQuestion) {
            assistant.rawContent = "I could not get this model to emit a usable edit tool call, so no file was changed. Try a stronger tool-capable model or rephrase with the exact file and operation.";
            assistant.finalizeContent();
            updateContextUsage();
            break;
          }
        }

        chatHistory.push({
          role: "assistant",
          content: roundText || ToolParser.cleanReplyForDisplay(rawRound),
        });
        const newText = roundText || ToolParser.cleanReplyForDisplay(rawRound) || rawRound;
        if (newText && !assistant.rawContent.trim()) {
          assistant.rawContent = newText;
        }
        assistant.finalizeContent();
        updateContextUsage();
        break;
      }

      const assistantMessage = {
        role: "assistant",
        content: visibleRoundText || "",
      };
      if (payload.toolCalls?.length) {
        assistantMessage.tool_calls = ToolParser.normalizeToolCallsForApi(payload.toolCalls);
      }
      chatHistory.push(assistantMessage);

      if (visibleRoundText) {
        const prev = ToolParser.cleanReplyForDisplay(assistant.rawContent);
        assistant.rawContent = prev && !prev.includes(visibleRoundText)
          ? `${prev}\n\n${visibleRoundText}`
          : visibleRoundText;
        assistant.syncDisplay();
      } else if (!assistant.displayContent().trim()) {
        assistant.rawContent = "";
        assistant.contentEl.hidden = true;
      }

      const toolResults = [];
      for (const tool of tools) {
        assistant.setStatus(ToolParser.toolStatusLabel(tool));
        const toolResult = await executeTool(tool, assistant.turn, assistant.contentEl, editContext);
        toolResults.push(toolResult);
        executedTools = true;
        if (
          !toolResult?.error
          && ToolMap.isMutating(tool)
          && ["full", "patch", "delete", "noop"].includes(toolResult.mode)
        ) {
          completedEdit = true;
        }
        chatHistory.push({
          role: "tool",
          content: ToolParser.toolResultMessage(toolResult),
          tool_name: tool.toolName || tool.action || "write_file",
          ...(tool.callId ? { tool_call_id: tool.callId } : {}),
        });
      }

      updateContextUsage();

      lastToolSummary = ToolParser.buildEditSummary(tools, toolResults);

      if (completedEdit && lastToolSummary) {
        assistant.rawContent = lastToolSummary;
        assistant.finalizeContent();
        break;
      }

      if (round === ToolParser.MAX_AGENT_ROUNDS - 1) {
        assistant.rawContent = lastToolSummary;
        const assistantIdx = chatHistory.length - toolResults.length - 1;
        if (chatHistory[assistantIdx]?.role === "assistant") {
          chatHistory[assistantIdx].content = lastToolSummary;
        }
        assistant.finalizeContent();
        break;
      }
    }

    if (completedEdit && !assistant.displayContent().trim()) {
      assistant.rawContent = lastToolSummary || "Updated the requested file.";
      assistant.finalizeContent();
    } else if (executedTools && !assistant.displayContent().trim()) {
      assistant.rawContent = lastToolSummary || assistant.rawContent;
      assistant.finalizeContent();
    }

    squashAgentTurn(historyStart);
    syncActiveChatSession();
  } finally {
    activeStreamContent = "";
    streaming = false;
    stopRequested = false;
    updateSendBtn();
    renderChatSessionSelect();
    updateContextUsage();
    syncActiveChatSession();
    chatInput.focus();
  }
}

function stopGeneration() {
  if (!streaming) return;
  stopRequested = true;
  activeStreamContent = "";
  window.api.abortChat?.();
  updateSendBtn();
  updateContextUsage();
}

sendBtn.addEventListener("click", () => {
  if (streaming) stopGeneration();
  else sendMessage();
});

btnTopTerminal?.addEventListener("click", () => {
  setTerminalCollapsed(!terminalCollapsed);
});

btnTopChat?.addEventListener("click", () => {
  if (chatCollapsed) {
    openChatPane({ createIfEmpty: true });
  } else {
    setChatCollapsed(true);
  }
});

btnWindowMinimize?.addEventListener("click", () => {
  window.api.windowMinimize?.();
});

btnWindowMaximize?.addEventListener("click", async () => {
  const maximized = await window.api.windowToggleMaximize?.();
  const icon = btnWindowMaximize.querySelector(".codicon");
  icon?.classList.toggle("codicon-chrome-maximize", !maximized);
  icon?.classList.toggle("codicon-chrome-restore", Boolean(maximized));
  btnWindowMaximize.title = maximized ? "Restore" : "Maximize";
});

btnWindowClose?.addEventListener("click", () => {
  window.api.windowClose?.();
});

btnChatNew?.addEventListener("click", (e) => {
  e.stopPropagation();
  newChatSession();
});
btnChatDelete?.addEventListener("click", (e) => {
  e.stopPropagation();
  deleteActiveChatSession();
});
btnChatHistory?.addEventListener("click", (e) => {
  e.stopPropagation();
  openChatHistoryPicker();
});
btnChatMore?.addEventListener("click", (e) => {
  e.stopPropagation();
  showChatOptions();
});
btnChatCollapse?.addEventListener("click", (e) => {
  e.stopPropagation();
  setChatCollapsed(true);
});
chatSessionSelect?.addEventListener("click", (e) => {
  const close = e.target.closest("[data-close-session]");
  if (close) {
    e.stopPropagation();
    deleteChatSession(close.dataset.closeSession);
    return;
  }

  const tab = e.target.closest(".chat-session-tab");
  if (!tab || streaming) return;
  loadChatSession(tab.dataset.sessionId);
});
chatHeader?.addEventListener("click", (e) => {
  const button = e.target.closest("button");
  if (!button) return;
  if (button.id === "btn-chat-new") newChatSession();
  if (button.id === "btn-chat-delete") deleteActiveChatSession();
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function updateSendBtn() {
  sendBtn.classList.toggle("stop", streaming);
  sendBtn.title = streaming ? "Stop generation" : "Send message";
  sendBtn.disabled = !streaming && !chatInput.value.trim();
}

function onChatInputChange() {
  resizeChatInput();
  updateSendBtn();
  updateContextUsage();
}

chatInput.addEventListener("input", onChatInputChange);
chatInput.addEventListener("paste", () => requestAnimationFrame(onChatInputChange));
chatInput.addEventListener("cut", () => requestAnimationFrame(onChatInputChange));

resizeChatInput();

if (chatPane && typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => resizeChatInput()).observe(chatPane);
}

contextUsageBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleContextPopover();
});

document.addEventListener("click", (e) => {
  if (!contextUsagePopover.hidden) {
    const inPopover = contextUsagePopover.contains(e.target) || contextUsageBtn.contains(e.target);
    if (!inPopover) closeContextPopover();
  }
});

messages.addEventListener("click", (e) => {
  const thinkingHeader = e.target.closest(".thinking-header");
  if (thinkingHeader) {
    const block = thinkingHeader.closest(".thinking-block");
    if (block) {
      block.classList.toggle("collapsed");
      const chevron = thinkingHeader.querySelector(".thinking-chevron");
      chevron?.classList.toggle("codicon-chevron-right", block.classList.contains("collapsed"));
      chevron?.classList.toggle("codicon-chevron-down", !block.classList.contains("collapsed"));
    }
    return;
  }

  const btn = e.target.closest(".md-code-copy");
  if (!btn) return;
  const block = btn.closest(".md-code-block");
  if (!block) return;
  const code = decodeURIComponent(block.dataset.code || "");
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy"; }, 1500);
  });
});

globalThis.addEventListener("markdown-ready", () => {
  document.querySelectorAll(".assistant-reply[data-raw-md], .thinking-body[data-raw-md]").forEach((el) => {
    globalThis.MarkdownRenderer.renderToElement(el, el.dataset.rawMd);
  });
});

// ── Resizable Panels ──────────────────────────────────────────────────────────

function makeDraggable(handle, onMove) {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    handle.classList.add("dragging");
    const move = (ev) => onMove(ev);
    const up = () => {
      handle.classList.remove("dragging");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
}

makeDraggable(sidebarResize, (e) => {
  const min = 170, max = 500;
  sidebar.style.width = Math.min(max, Math.max(min, e.clientX)) + "px";
});

makeDraggable(chatResize, (e) => {
  const min = 280, max = 600;
  const w = window.innerWidth - e.clientX;
  chatPane.style.width = Math.min(max, Math.max(min, w)) + "px";
  resizeChatInput();
});

function setTerminalCollapsed(collapsed) {
  terminalCollapsed = collapsed;
  terminalPane.classList.toggle("collapsed", collapsed);
  terminalResize.classList.toggle("collapsed-hint", collapsed);
  btnTopTerminal?.classList.toggle("active", !collapsed);
  btnTopTerminal?.classList.toggle("inactive", collapsed);

  if (collapsed) {
    if (terminalPane.offsetHeight > TERMINAL_MIN_EXPANDED) {
      terminalSavedHeight = terminalPane.offsetHeight;
    }
    terminalPane.style.height = "0px";
    terminalPane.style.flex = "none";
    editorPane.style.flex = "1";
    editorPane.style.height = "";
  } else {
    terminalPane.style.height = `${terminalSavedHeight}px`;
    terminalPane.style.flex = "none";
    editorPane.style.flex = "none";
    const centerH = centerPanel.getBoundingClientRect().height;
    const editorH = Math.max(EDITOR_MIN_HEIGHT, centerH - terminalSavedHeight);
    editorPane.style.height = `${editorH}px`;
    requestAnimationFrame(() => {
      EditorManager.layout();
      TerminalManager.fitActive();
    });
  }
}

globalThis.expandTerminalPanel = () => {
  if (terminalCollapsed) setTerminalCollapsed(false);
  return true;
};

globalThis.toggleTerminalPanel = () => {
  const nextCollapsed = !terminalCollapsed;
  setTerminalCollapsed(nextCollapsed);
  return !nextCollapsed;
};

makeDraggable(terminalResize, (e) => {
  const rect = centerPanel.getBoundingClientRect();
  const relY = e.clientY - rect.top;
  const collapseAt = rect.height - 12;

  if (relY >= collapseAt) {
    if (!terminalCollapsed) setTerminalCollapsed(true);
    return;
  }

  if (terminalCollapsed) {
    setTerminalCollapsed(false);
  }

  const editorH = Math.min(
    rect.height - TERMINAL_MIN_EXPANDED,
    Math.max(EDITOR_MIN_HEIGHT, relY),
  );
  terminalSavedHeight = rect.height - editorH;

  editorPane.style.height = `${editorH}px`;
  editorPane.style.flex = "none";
  terminalPane.style.height = `${terminalSavedHeight}px`;
  terminalPane.style.flex = "none";

  EditorManager.layout();
  TerminalManager.fitActive();
});

terminalResize.addEventListener("dblclick", () => {
  setTerminalCollapsed(!terminalCollapsed);
});

updateSendBtn();
renderChatSessionSelect();
setChatCollapsed(false);
setTerminalCollapsed(false);
chatInput.focus();
restoreLastWorkspace();
