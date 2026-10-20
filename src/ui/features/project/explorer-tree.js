import { btnNewFile, btnNewFolder, fileTree, chatInput } from "../../core/dom-refs.js";
import { appState } from "../../core/app-state.js";
import { openFile, closeTabsUnderWorkspacePath, openTabs } from "../editor/editor-tabs.js";
import { openWorkspaceContextMenu, closeWorkspaceContextMenu } from "./explorer-context-menu.js";
import {
  normPath, remapWorkspacePath, relativePathFromRoot, joinWorkspacePath, basenameOf,
  pathIsAtOrUnder,
} from "../../core/workspace-paths.js";
import { SetiIconTheme, ExplorerSelection } from "../../core/runtime-globals.js";
import { refreshDirMap } from "../chat/prompt-context.js";
import { isRunningChatActive } from "../chat/chat-run-state.js";
import { updateSendBtn } from "../chat/composer-input.js";
import { syncActiveChatSession } from "../chat/chat-sessions.js";

// ── State ─────────────────────────────────────────────────────────────────────
export const selectedExplorerPaths = new Set();
export const expandedTreePaths = new Set();

export function setExplorerActionsEnabled(enabled) {
  btnNewFile.disabled = !enabled;
  btnNewFolder.disabled = !enabled;
}

export const EXPLORER_TREE_BASE_PADDING = 4;
export const EXPLORER_TREE_LEVEL_INDENT = 8;

export function explorerTreeDepth(item) {
  const explicit = Number(item?.dataset?.treeDepth);
  if (Number.isSafeInteger(explicit) && explicit >= 0) return explicit;
  const padding = Number.parseInt(item?.style?.paddingLeft, 10);
  if (!Number.isFinite(padding)) return 0;
  return Math.max(0, Math.round((padding - EXPLORER_TREE_BASE_PADDING) / EXPLORER_TREE_LEVEL_INDENT));
}

export function setExplorerTreeDepth(item, depth = 0) {
  const normalized = Math.max(0, Number.isSafeInteger(Number(depth)) ? Number(depth) : 0);
  item.dataset.treeDepth = String(normalized);
  item.style.paddingLeft = `${EXPLORER_TREE_BASE_PADDING + (normalized * EXPLORER_TREE_LEVEL_INDENT)}px`;
  item.setAttribute("aria-level", String(normalized + 1));
  return normalized;
}

export async function createNewItemInput(isFolder) {
  if (!appState.rootPath || appState.creatingItem || appState.renamingItem) return;
  appState.creatingItem = true;

  let targetDir = appState.rootPath;
  let targetContainer = fileTree;
  let inputDepth = 0;

  // If an item is highlighted, contextualize where to add the new element
  if (appState.selectedItem) {
    const isDir = appState.selectedItem.dataset.isDir === "true";
    if (isDir) {
      targetDir = appState.selectedItem.dataset.path;
      const childrenContainer = appState.selectedItem.nextElementSibling;
      
      // Auto-expand directory exactly like VS Code
      const chevron = appState.selectedItem.querySelector(".tree-chevron");
      const icon = appState.selectedItem.querySelector(".tree-icon");
      setTreeChevronExpanded(chevron, true);
      if (icon) icon.className = "tree-icon codicon codicon-folder-opened";
      if (childrenContainer) childrenContainer.style.display = "block";
      setExpandedTreePath(targetDir, true);
      
      // Force directory load if it hasn't been cached/expanded yet
      if (childrenContainer && (childrenContainer.childElementCount === 0 || (childrenContainer.children.length === 1 && childrenContainer.children[0].textContent === "Loading…"))) {
        const currentDepth = explorerTreeDepth(appState.selectedItem);
        childrenContainer.innerHTML = "";
        await renderTree(targetDir, childrenContainer, currentDepth + 1);
      }
      
      targetContainer = childrenContainer;
      inputDepth = explorerTreeDepth(appState.selectedItem) + 1;
    } else {
      // If a file is selected, create adjacent to it inside its parent folder
      const filePath = appState.selectedItem.dataset.path;
      const lastIdx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
      targetDir = filePath.substring(0, lastIdx);
      targetContainer = appState.selectedItem.parentElement;
      inputDepth = explorerTreeDepth(appState.selectedItem);
    }
  }

  // Generate the temporary tree input node
  const inputRow = document.createElement("div");
  inputRow.className = `tree-item tree-input-row ${isFolder ? "tree-dir" : "tree-file"}`;
  setExplorerTreeDepth(inputRow, inputDepth);

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
      appState.creatingItem = false;
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
      await AppDialog.alert(`Error creating item: ${result.error}`, { title: "Create failed" });
      inputRow.remove();
    } else {
      // Re-render folder node to sync new additions sorted alphabetically
      if (targetContainer === fileTree) {
        await rerenderExplorer({ preserveSelectionPath: newPath });
      } else {
        const parentItem = targetContainer.previousElementSibling;
        const parentDepth = explorerTreeDepth(parentItem);
        await renderTree(targetDir, targetContainer, parentDepth + 1);
      }
      
      // If it's a file, automatically open and highlight it
      if (!isFolder) {
        await openFile(newPath, name);
        const items = targetContainer.querySelectorAll(".tree-item");
        for (const itemRow of items) {
          if (itemRow.dataset.path === newPath) {
            selectItem(itemRow, { focus: false });
            break;
          }
        }
      }
    }
    appState.creatingItem = false;
  }

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      finished = true;
      inputRow.remove();
      appState.creatingItem = false;
    }
  });

  input.addEventListener("blur", async () => {
    await commit();
  });
}

export function isExpandedTreePath(filePath) {
  return expandedTreePaths.has(normPath(filePath));
}

export function setTreeChevronExpanded(chevron, expanded) {
  if (!chevron) return;
  const isExpanded = Boolean(expanded);
  chevron.classList.toggle("expanded", isExpanded);
  chevron.classList.toggle("codicon-chevron-down", isExpanded);
  chevron.classList.toggle("codicon-chevron-right", !isExpanded);
}

export function setExpandedTreePath(filePath, expanded) {
  const key = normPath(filePath);
  if (expanded) expandedTreePaths.add(key);
  else expandedTreePaths.delete(key);
}

export function remapExpandedTreePathsUnder(sourceAbsolute, destinationAbsolute) {
  const replacements = [];
  for (const expandedPath of expandedTreePaths) {
    const nextPath = remapWorkspacePath(expandedPath, sourceAbsolute, destinationAbsolute);
    if (nextPath !== normPath(expandedPath)) replacements.push([expandedPath, nextPath]);
  }
  for (const [previous, next] of replacements) {
    expandedTreePaths.delete(previous);
    expandedTreePaths.add(next);
  }
}

export const treeRenderGenerations = new WeakMap();

export async function renderTree(dirPath, container, depth) {
  const renderGeneration = (treeRenderGenerations.get(container) || 0) + 1;
  treeRenderGenerations.set(container, renderGeneration);
  container.replaceChildren();
  const entries = await window.api.readdir(dirPath);
  if (treeRenderGenerations.get(container) !== renderGeneration) return;

  if (entries.error) {
    const errorRow = document.createElement("div");
    errorRow.className = "tree-item dimmed";
    setExplorerTreeDepth(errorRow, depth);
    errorRow.textContent = entries.error;
    container.replaceChildren(errorRow);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = `tree-item ${entry.isDir ? "tree-dir" : "tree-file"}`;
    setExplorerTreeDepth(item, depth);
    item.dataset.path  = entry.path;
    item.dataset.isDir = entry.isDir;
    item.tabIndex = -1;
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-selected", "false");

    const chevron = document.createElement("span");
    chevron.className = entry.isDir
      ? "tree-chevron codicon codicon-chevron-right"
      : "tree-chevron codicon hidden";

    const icon = document.createElement("span");
    if (entry.isDir) {
      icon.className = "tree-icon codicon codicon-folder";
    } else {
      const info = SetiIconTheme.iconForFile(entry.name);
      icon.className = "tree-file-icon seti-icon";
      icon.textContent = info.glyph;
      icon.style.color = info.color;
    }
    icon.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = entry.name;

    item.appendChild(chevron);
    item.appendChild(icon);
    item.appendChild(name);
    container.appendChild(item);
    item.addEventListener("contextmenu", (event) => openWorkspaceContextMenu(event, entry, item));

    // Drag-and-drop: move a file or folder into another folder (or the root).
    item.draggable = true;
    item.addEventListener("dragstart", (event) => {
      const rel = relativePathFromRoot(entry.path);
      if (!rel) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/xekute-tree-path", rel);
      event.dataTransfer.setData("text/xekute-tree-isdir", entry.isDir ? "1" : "0");
      item.classList.add("tree-dragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("tree-dragging");
      fileTree?.classList.remove("tree-drop-root");
      clearTreeDropTargets();
    });
    if (entry.isDir) {
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        item.classList.add("tree-drop-target");
      });
      item.addEventListener("dragleave", () => {
        item.classList.remove("tree-drop-target");
      });
      item.addEventListener("drop", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        item.classList.remove("tree-drop-target");
        await moveDroppedTreeItem(event, { isDir: true, relativePath: relativePathFromRoot(entry.path), path: entry.path });
      });

      // Also allow dropping into the folder's expanded children area (blank
      // space inside the folder subtree) — moves the item into this folder.
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "tree-children";
      childrenContainer.style.display = "none";
      container.appendChild(childrenContainer);
      childrenContainer.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        childrenContainer.classList.add("tree-drop-target");
        item.classList.add("tree-drop-target");
      });
      childrenContainer.addEventListener("dragleave", () => {
        childrenContainer.classList.remove("tree-drop-target");
        item.classList.remove("tree-drop-target");
      });
      childrenContainer.addEventListener("drop", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        childrenContainer.classList.remove("tree-drop-target");
        item.classList.remove("tree-drop-target");
        await moveDroppedTreeItem(event, { isDir: true, relativePath: relativePathFromRoot(entry.path), path: entry.path });
      });

      let expanded = isExpandedTreePath(entry.path);

      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        selectItem(item, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey });
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        expanded = !expanded;
        setExpandedTreePath(entry.path, expanded);
        item.setAttribute("aria-expanded", String(expanded));
        setTreeChevronExpanded(chevron, expanded);
        icon.className = `tree-icon codicon ${expanded ? "codicon-folder-opened" : "codicon-folder"}`;
        childrenContainer.style.display = expanded ? "block" : "none";
        if (expanded && childrenContainer.childElementCount === 0) {
          const loading = document.createElement("div");
          loading.className = "tree-item dimmed";
          setExplorerTreeDepth(loading, depth + 1);
          loading.textContent = "Loading…";
          childrenContainer.replaceChildren(loading);
          await renderTree(entry.path, childrenContainer, depth + 1);
        }
      });

      if (expanded) {
        setTreeChevronExpanded(chevron, true);
        icon.className = "tree-icon codicon codicon-folder-opened";
        childrenContainer.style.display = "block";
        await renderTree(entry.path, childrenContainer, depth + 1);
      }
    } else {
      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        selectItem(item, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey });
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        await openFile(entry.path, entry.name, { focusEditor: false });
      });
      item.addEventListener("dblclick", async (e) => {
        e.stopPropagation();
        selectItem(item);
        await openFile(entry.path, entry.name, { focusEditor: true });
      });
    }

    item.addEventListener("keydown", async (e) => {
      if (!['Enter', ' '].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      selectItem(item);
      if (entry.isDir) item.click();
      else await openFile(entry.path, entry.name);
    });
  }
}

export function clearTreeDropTargets() {
  fileTree?.querySelectorAll(".tree-drop-target").forEach((el) => el.classList.remove("tree-drop-target"));
}

export async function moveDroppedTreeItem(event, { isDir = false, relativePath = "", path = "" } = {}) {
  const sourceRel = event.dataTransfer?.getData("text/xekute-tree-path");
  if (!sourceRel) return;
  const sourceIsDir = event.dataTransfer.getData("text/xekute-tree-isdir") === "1";
  if (sourceRel === relativePath) return; // dropping onto itself
  if (sourceIsDir && relativePath && relativePath.startsWith(`${sourceRel}/`)) {
    // cannot drop a folder into its own descendant
    await AppDialog.alert("A folder cannot be moved into itself.", { title: "Cannot move" });
    return;
  }
  const transfer = window.api?.movePath;
  if (typeof transfer !== "function") {
    await AppDialog.alert("Workspace move is unavailable. Restart XEKUTE and try again.", { title: "Move unavailable" });
    return;
  }
  const sourceName = sourceRel.split("/").pop();
  const destination = relativePath ? `${relativePath}/${sourceName}` : sourceName;
  const result = await transfer({ workspace: appState.rootPath, source: sourceRel, destination });
  if (result?.error) {
    await AppDialog.alert(`Could not move ${sourceName}: ${result.error}`, { title: "Move failed" });
    return;
  }
  const sourceAbsolute = joinWorkspacePath(sourceRel);
  closeTabsUnderWorkspacePath(sourceAbsolute, { force: true });
  clearExpandedTreePathsUnder(sourceAbsolute);
  await refreshWorkspaceUi({ preserveSelectionPath: joinWorkspacePath(result.destination || destination) });
  restoreChatComposerAfterUiAction();
}

export function explorerPathKey(value = "") {
  const normalized = normPath(String(value || ""));
  if (/^[a-zA-Z]:\//.test(normalized) || (appState.rootPath && String(appState.rootPath).includes("\\"))) {
    return normalized.toLowerCase();
  }
  return normalized;
}

export function findExplorerTreeItem(targetPath) {
  if (!targetPath || !fileTree) return null;
  const key = explorerPathKey(targetPath);
  return [...fileTree.querySelectorAll(".tree-item[data-path]")]
    .find((item) => explorerPathKey(item.dataset.path) === key) || null;
}

export function expandExplorerAncestors(relativePath) {
  if (!appState.rootPath || !relativePath) return;
  const segments = String(relativePath).split("/").filter(Boolean);
  for (let i = 0; i < segments.length - 1; i++) {
    setExpandedTreePath(joinWorkspacePath(segments.slice(0, i + 1).join("/")), true);
  }
}

export function isVisibleExplorerItem(item) {
  if (!item?.dataset?.path) return false;
  let children = item.parentElement?.closest?.(".tree-children");
  while (children) {
    if (children.style.display === "none") return false;
    children = children.parentElement?.closest?.(".tree-children");
  }
  return true;
}

export function visibleExplorerItems() {
  return [...(fileTree?.querySelectorAll?.(".tree-item[data-path]") || [])].filter(isVisibleExplorerItem);
}

export function syncExplorerSelectionUI({ primaryPath = "", focus = true } = {}) {
  const rows = [...(fileTree?.querySelectorAll?.(".tree-item[data-path]") || [])];
  const preferred = explorerPathKey(primaryPath || appState.selectedItem?.dataset?.path || "");
  let primary = null;
  for (const row of rows) {
    const path = explorerPathKey(row.dataset.path);
    const selected = selectedExplorerPaths.has(path);
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", String(selected));
    row.tabIndex = -1;
    if (selected && path === preferred) primary = row;
  }
  if (!primary) primary = rows.find((row) => selectedExplorerPaths.has(explorerPathKey(row.dataset.path))) || null;
  appState.selectedItem = primary;
  if (!appState.selectedItem) return;
  appState.selectedItem.tabIndex = 0;
  if (focus && document.activeElement !== appState.selectedItem) appState.selectedItem.focus({ preventScroll: true });
}

export function selectItem(el, { focus = true, ctrlKey = false, metaKey = false, shiftKey = false, contextMenu = false } = {}) {
  if (!el?.dataset?.path) {
    selectedExplorerPaths.clear();
    appState.explorerSelectionAnchorPath = "";
    syncExplorerSelectionUI({ primaryPath: "", focus: false });
    return;
  }
  const clickedPath = explorerPathKey(el.dataset.path);
  const orderedVisiblePaths = visibleExplorerItems().map((item) => explorerPathKey(item.dataset.path));
  const next = ExplorerSelection.nextSelection({
    selectedPaths: [...selectedExplorerPaths],
    anchorPath: appState.explorerSelectionAnchorPath,
    clickedPath,
    orderedVisiblePaths,
    additive: Boolean(ctrlKey || metaKey),
    range: Boolean(shiftKey),
    contextMenu: Boolean(contextMenu),
  });
  selectedExplorerPaths.clear();
  next.selectedPaths.forEach((path) => selectedExplorerPaths.add(path));
  appState.explorerSelectionAnchorPath = next.anchorPath;
  syncExplorerSelectionUI({ primaryPath: next.primaryPath, focus });
}

export async function rerenderExplorer(options = {}) {
  if (!appState.rootPath) return;
  const explicitSelection = Object.prototype.hasOwnProperty.call(options, "preserveSelectionPath");
  const requestedPrimary = explicitSelection
    ? explorerPathKey(options.preserveSelectionPath || "")
    : explorerPathKey(appState.selectedItem?.dataset.path || "");
  const requestedPaths = explicitSelection
    ? (requestedPrimary ? [requestedPrimary] : [])
    : [...selectedExplorerPaths];
  const requestedAnchor = explicitSelection ? requestedPrimary : appState.explorerSelectionAnchorPath;
  // Background refreshes (file watcher, agent writes) must not pull focus out
  // of the editor or chat; only a tree that already had focus gets it back.
  const activeElement = globalThis.document?.activeElement;
  const treeHadFocus = Boolean(activeElement && typeof fileTree?.contains === "function" && fileTree.contains(activeElement));
  closeWorkspaceContextMenu();
  await renderTree(appState.rootPath, fileTree, 0);
  // Allow dropping a dragged item onto the tree root (empty area) to move it to the project root.
  if (!fileTree.dataset.treeDropBound) {
    fileTree.dataset.treeDropBound = "1";
    fileTree?.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types?.includes("text/xekute-tree-path")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      fileTree.classList.add("tree-drop-root");
    });
    fileTree?.addEventListener("dragleave", (event) => {
      if (event.relatedTarget && fileTree.contains(event.relatedTarget)) return;
      fileTree.classList.remove("tree-drop-root");
    });
    fileTree?.addEventListener("drop", async (event) => {
      if (!event.dataTransfer?.types?.includes("text/xekute-tree-path")) return;
      event.preventDefault();
      fileTree.classList.remove("tree-drop-root");
      const droppedOnItem = event.target?.closest?.(".tree-item");
      if (droppedOnItem) return; // folder-item drop handlers already fired (they stopPropagation)
      await moveDroppedTreeItem(event, { relativePath: "" });
    });
  }
  const availablePaths = new Set([...fileTree.querySelectorAll(".tree-item[data-path]")].map((item) => explorerPathKey(item.dataset.path)));
  selectedExplorerPaths.clear();
  requestedPaths.filter((path) => availablePaths.has(path)).forEach((path) => selectedExplorerPaths.add(path));
  appState.explorerSelectionAnchorPath = availablePaths.has(requestedAnchor)
    ? requestedAnchor
    : ([...selectedExplorerPaths][0] || "");
  syncExplorerSelectionUI({ primaryPath: requestedPrimary, focus: treeHadFocus && Boolean(selectedExplorerPaths.size) });
}

export function refreshWorkspaceUi(options = {}) {
  const workspaceAtRequest = appState.rootPath;
  const refresh = appState.workspaceUiRefreshQueue.catch(() => {}).then(async () => {
    if (!workspaceAtRequest || normPath(appState.rootPath) !== normPath(workspaceAtRequest)) return;
    await refreshDirMap();
    if (normPath(appState.rootPath) !== normPath(workspaceAtRequest)) return;
    await rerenderExplorer(options);
  });
  appState.workspaceUiRefreshQueue = refresh;
  return refresh;
}

export function isLiveWorkspaceInput(element) {
  if (!element || element === document.body || !element.isConnected) return false;
  if (element.closest?.("#workspace-context-menu, #custom-context-menu, [hidden], [aria-hidden=\"true\"]")) return false;
  return Boolean(element.closest?.("#chat-input, .composer, #monaco-container, .monaco-editor, #terminal-viewport, .xterm, input, textarea, select, [contenteditable=\"true\"]"));
}

export function releaseWorkspaceMutationFocus() {
  const active = document.activeElement;
  if (active?.closest?.(".tree-item, #workspace-context-menu, #custom-context-menu")) {
    active.blur();
  }
}

export function restoreChatComposerAfterUiAction() {
  if (!chatInput) return;
  chatInput.disabled = false;
  chatInput.readOnly = false;
  chatInput.removeAttribute("aria-disabled");
  updateSendBtn();
  if (!isRunningChatActive()) {
    requestAnimationFrame(() => {
      chatInput.disabled = false;
      chatInput.readOnly = false;
      chatInput.removeAttribute("aria-disabled");
      updateSendBtn();
      // Workspace refreshes can remove the focused tree row or hide the
      // context-menu button that owned focus. Recover the composer in that
      // case, but never steal focus from a live editor or terminal.
      if (!isLiveWorkspaceInput(document.activeElement)) {
        chatInput.focus({ preventScroll: true });
      }
    });
  }
}

export function clearExpandedTreePathsUnder(absPath) {
  const prefix = normPath(absPath);
  for (const item of [...expandedTreePaths]) {
    if (item === prefix || item.startsWith(`${prefix}/`)) {
      expandedTreePaths.delete(item);
    }
  }
}

export function selectedExplorerTargets() {
  const rows = [...(fileTree?.querySelectorAll?.(".tree-item[data-path]") || [])];
  const byPath = new Map(rows.map((row) => [explorerPathKey(row.dataset.path), row]));
  const targets = [...selectedExplorerPaths].map((path) => {
    const row = byPath.get(path);
    if (!row) return null;
    return {
      path,
      relPath: relativePathFromRoot(path),
      isDir: row.dataset.isDir === "true",
      label: row.querySelector(".tree-name")?.textContent || basenameOf(path),
      item: row,
    };
  }).filter((target) => target?.relPath);
  return ExplorerSelection.topLevelTargets(targets);
}

export async function reconcileDeletedWorkspacePaths(targets = []) {
  const deleted = (Array.isArray(targets) ? targets : []).filter((target) => target?.path && target?.relPath);
  if (!deleted.length) return;
  releaseWorkspaceMutationFocus();
  for (const target of deleted) {
    closeTabsUnderWorkspacePath(target.path, { force: true });
    clearExpandedTreePathsUnder(target.path);
    for (const selectedPath of [...selectedExplorerPaths]) {
      if (pathIsAtOrUnder(selectedPath, target.path)) selectedExplorerPaths.delete(selectedPath);
    }
    appState.contextFilesCache = appState.contextFilesCache.filter((file) => file.path !== target.relPath && !file.path.startsWith(`${target.relPath}/`));
  }
  if (deleted.some((target) => pathIsAtOrUnder(appState.explorerSelectionAnchorPath, target.path))) {
    appState.explorerSelectionAnchorPath = [...selectedExplorerPaths][0] || "";
  }
  syncActiveChatSession();
  await refreshWorkspaceUi();
}

export async function reconcileDeletedWorkspacePath(absPath, relPath) {
  await reconcileDeletedWorkspacePaths([{ path: absPath, relPath }]);
}

export async function deleteSelectedExplorerItem() {
  if (!appState.rootPath || !appState.selectedItem || appState.deletingExplorerItem) return;
  const targets = selectedExplorerTargets();
  if (!targets.length) return;
  const hasDirtyTabs = [...openTabs.entries()].some(([tabPath, tab]) => tab?.dirty && targets.some((target) => pathIsAtOrUnder(tabPath, target.path)));
  const dirtyWarning = hasDirtyTabs ? "\n\nUnsaved editor changes under this path will be discarded." : "";
  const only = targets[0];
  const multiple = targets.length > 1;
  const confirmed = await AppDialog.confirm(
    multiple
      ? `Delete ${targets.length} selected items? Selected folders and everything inside them will be removed.${dirtyWarning}`
      : only.isDir
        ? `Delete folder "${only.label}" and everything inside it?${dirtyWarning}`
        : `Delete file "${only.label}"?${dirtyWarning}`,
    { title: multiple ? "Delete selected items" : only.isDir ? "Delete folder" : "Delete file", confirmLabel: "Delete", tone: "danger" },
  );
  if (!confirmed) return;

  appState.deletingExplorerItem = true;
  try {
    const deleted = [];
    for (const target of targets) {
      const result = await window.api.deletePath({ workspace: appState.rootPath, path: target.relPath });
      if (result?.error) {
        await AppDialog.alert(`Could not delete ${target.label}: ${result.error}`, { title: "Delete failed" });
        break;
      }
      deleted.push(target);
    }
    if (appState.workspaceClipboard && deleted.some((target) => pathIsAtOrUnder(appState.workspaceClipboard.relativePath, target.relPath))) {
      appState.workspaceClipboard = null;
    }
    await reconcileDeletedWorkspacePaths(deleted);
  } catch (error) {
    await AppDialog.alert(`Delete failed: ${error?.message || "Unexpected workspace error"}`, { title: "Delete failed" });
  } finally {
    appState.deletingExplorerItem = false;
    restoreChatComposerAfterUiAction();
  }
}

export function isExplorerKeyboardTarget() {
  const active = document.activeElement;
  return active === document.body || Boolean(active?.closest?.("#file-tree, #sidebar-header, #workspace-context-menu"));
}

export function setContextTargetFromSelectedItem() {
  if (!appState.selectedItem?.dataset?.path) return false;
  appState.workspaceContextTarget = {
    path: appState.selectedItem.dataset.path,
    relativePath: relativePathFromRoot(appState.selectedItem.dataset.path),
    isDir: appState.selectedItem.dataset.isDir === "true",
    name: appState.selectedItem.querySelector(".tree-name")?.textContent || basenameOf(appState.selectedItem.dataset.path),
    item: appState.selectedItem,
  };
  return Boolean(appState.workspaceContextTarget.relativePath);
}
