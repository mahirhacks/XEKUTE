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
const sendBtn          = $("send-btn");
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
const centerPanel      = $("center-panel");
const editorPane       = $("editor-pane");
const terminalPane     = $("terminal-pane");
const terminalResize   = $("terminal-resize");
const statusLnCol      = $("status-ln-col");
const statusOllamaPort = $("status-ollama-port");

const OLLAMA_PORT = 11434;

// ── State ─────────────────────────────────────────────────────────────────────
let rootPath     = null;
let selectedItem = null;
let chatHistory  = [];
let streaming    = false;
let activeStreamContent = "";

const CONTEXT_RING_R = 8;
const CONTEXT_RING_C = 2 * Math.PI * CONTEXT_RING_R;

/** @type {Map<string, { path: string, diskPath: string, name: string, content: string | null, savedContent: string, dirty: boolean, error: string | null }>} */
const openTabs      = new Map();
let activeTabPath   = null;
let editorLoadedPath = null;

let selectedModel = localStorage.getItem("pointer:model") || "";
let allModels     = [];
let editingModel  = null;

const CONTEXT_OPTIONS = ["4K", "8K", "16K", "32K", "64K", "128K", "256K"];
const MODEL_SETTINGS_KEY = "pointer:modelSettings";

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
  return msgs.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
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
  let used = estimateMessagesTokens(chatHistory);
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
    explorerTitle.textContent = projectName(folder);
    explorerTitle.title = folder;
  } else {
    explorerTitle.textContent = "Explorer";
    explorerTitle.title = "";
  }
}

// ── File Explorer ─────────────────────────────────────────────────────────────

btnOpenFolder.addEventListener("click", async () => {
  const folder = await window.api.openFolder();
  if (!folder) return;
  rootPath = folder;
  setProjectFolder(folder);
  setExplorerActionsEnabled(true);
  TerminalManager.setCwd(folder);
  await renderTree(folder, fileTree, 0);
  await TerminalManager.openWithProject(folder);
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
  if (!tab || tab.error || !tab.dirty) return;

  const result = await window.api.writeFile(tab.diskPath, tab.content);
  if (result.error) {
    editorError.textContent = result.error;
    editorError.hidden = false;
    EditorManager.clear();
    return;
  }

  tab.savedContent = tab.content;
  tab.dirty = false;
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
  modelLabel.textContent = selectedModel || "Select model";
  updateContextUsage();
}

function positionModelMenu() {
  const rect = modelPicker.getBoundingClientRect();
  const menuH = modelMenu.offsetHeight || 320;
  const menuW = modelMenu.offsetWidth || 280;
  let top = rect.top - menuH - 8;
  let left = rect.left;

  if (top < 8) top = rect.bottom + 8;
  if (left + menuW > window.innerWidth - 8) {
    left = window.innerWidth - menuW - 8;
  }
  if (left < 8) left = 8;

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

async function loadModels() {
  showModelListLoading();
  try {
    const result = await window.api?.listModels?.();
    if (!window.api?.listModels) {
      modelList.innerHTML = `<div class="model-list-empty">App bridge not ready. Restart the app.</div>`;
      return;
    }
    if (!result || result.error) {
      allModels = selectedModel ? [selectedModel] : [];
      modelList.innerHTML = `<div class="model-list-empty">${escapeHtml(result?.error || "Failed to load models")}</div>`;
    } else {
      allModels = Array.isArray(result.models) ? result.models : [];
      const custom = selectedModel && !allModels.includes(selectedModel)
        ? [selectedModel]
        : [];
      allModels = [...new Set([...custom, ...allModels])].sort();
      if (!selectedModel && allModels.length) {
        selectedModel = allModels[0];
        localStorage.setItem("pointer:model", selectedModel);
      }
      renderModelList();
    }
  } catch (err) {
    allModels = selectedModel ? [selectedModel] : [];
    modelList.innerHTML = `<div class="model-list-empty">${escapeHtml(err.message || "Failed to load models")}</div>`;
  } finally {
    syncModelLabel();
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
}

async function openModelMenu() {
  closeModelEditMenu();
  closeContextPopover();
  modelMenu.hidden = false;
  modelPicker.classList.add("open");
  await loadModels();
  requestAnimationFrame(() => {
    positionModelMenu();
    modelSearch.focus();
  });
}

modelPicker.addEventListener("click", (e) => {
  e.stopPropagation();
  if (modelMenu.hidden) {
    openModelMenu();
  } else {
    closeModelMenu();
  }
});

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
  if (!modelMenu.hidden) positionModelMenu();
  if (!contextUsagePopover.hidden) positionContextPopover();
  if (!modelEditMenu.hidden && editingModel) {
    const row = [...modelList.querySelectorAll(".model-item")].find(
      (el) => el.dataset.model === editingModel,
    );
    if (row) positionModelEditMenu(row);
  }
});

loadModels();
updateContextUsage();

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

  const contentEl = document.createElement("div");
  contentEl.className = "assistant-reply";
  turn.appendChild(contentEl);
  messages.appendChild(turn);
  scrollMessages();

  const assistant = {
    turn,
    contentEl,
    rawContent: "",
    thinkingBlock,
    thinkingBody,
    thinkingMeta,
    appendContent(token) {
      this.rawContent += token;
      if (globalThis.MarkdownRenderer) {
        globalThis.MarkdownRenderer.scheduleRender(
          this.contentEl,
          () => this.rawContent,
          true,
        );
      } else {
        this.contentEl.dataset.rawMd = this.rawContent;
        this.contentEl.textContent = this.rawContent;
      }
      scrollMessages();
    },
    finalizeContent() {
      if (globalThis.MarkdownRenderer) {
        globalThis.MarkdownRenderer.renderToElement(this.contentEl, this.rawContent);
      } else {
        this.contentEl.dataset.rawMd = this.rawContent;
        this.contentEl.textContent = this.rawContent;
      }
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
      thinkingBody.textContent += text;
      scrollMessages();
    },
    finishThinking() {
      this.stopThinkingTimer();
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
  chatInput.style.height = "";
  addUserMessage(text);
  chatHistory.push({ role: "user", content: text });

  streaming = true;
  updateSendBtn();
  activeStreamContent = "";
  updateContextUsage();

  const settings = getModelSettings(selectedModel);
  const assistant = createAssistantTurn(settings.thinking);
  assistant.contentEl.classList.add("streaming");

  let contentStarted = false;

  window.api.removeAllListeners("ollama:token");
  window.api.removeAllListeners("ollama:thinking");
  window.api.removeAllListeners("ollama:done");

  window.api.onThinking((token) => {
    assistant.appendThinking(token);
  });

  window.api.onToken((token) => {
    if (!contentStarted) {
      contentStarted = true;
      assistant.finishThinking();
    }
    assistant.appendContent(token);
    activeStreamContent = assistant.rawContent;
    updateContextUsage();
  });

  window.api.onDone(() => {
    assistant.contentEl.classList.remove("streaming");
    assistant.finishThinking();
    assistant.finalizeContent();
    if (assistant.thinkingBlock && !assistant.thinkingBody?.textContent) {
      assistant.thinkingBlock.hidden = true;
    }
    chatHistory.push({ role: "assistant", content: assistant.rawContent });
    activeStreamContent = "";
    streaming = false;
    updateSendBtn();
    updateContextUsage();
    chatInput.focus();
  });

  const result = await window.api.chat({
    messages: chatHistory,
    model: selectedModel,
    numCtx: contextToTokens(settings.context),
    thinking: settings.thinking,
  });

  if (result.error) {
    assistant.turn.remove();
    addErrorMessage(result.error);
    activeStreamContent = "";
    streaming = false;
    updateSendBtn();
    updateContextUsage();
    chatHistory.pop();
  }
}

sendBtn.addEventListener("click", sendMessage);

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function updateSendBtn() {
  sendBtn.disabled = streaming || !chatInput.value.trim();
}

chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + "px";
  updateSendBtn();
  updateContextUsage();
});

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
  document.querySelectorAll(".assistant-reply[data-raw-md]").forEach((el) => {
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
});

makeDraggable(terminalResize, (e) => {
  const rect = centerPanel.getBoundingClientRect();
  const relY = e.clientY - rect.top;
  const minEditor = 120;
  const minTerminal = 80;
  const maxEditor = rect.height - minTerminal;
  const editorH = Math.min(maxEditor, Math.max(minEditor, relY));
  editorPane.style.height = editorH + "px";
  editorPane.style.flex = "none";
  terminalPane.style.flex = "1";
  EditorManager.layout();
  TerminalManager.fitActive();
});

updateSendBtn();
chatInput.focus();
