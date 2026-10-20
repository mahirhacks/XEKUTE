import {
  customTreeItems, customContextMenu, customContextDelete, customContextDeleteLabel,
  settingsUIView, resourceViewerTitle, resourceViewerMeta, resourceViewerEmpty,
  resourceViewerContent, resourceViewerCopy, checklistUIView, scopeUIView,
} from "../../core/dom-refs.js";
import { appState } from "../../core/app-state.js";
import {
  refreshWorkspaceUi, releaseWorkspaceMutationFocus, restoreChatComposerAfterUiAction,
} from "../project/explorer-tree.js";
import { assessmentDiskPath } from "./assessment-workspace.js";
import { setResourceDirty, showResourcePreview } from "./resource-viewer.js";
import { settingsViewSwitch } from "../../bootstrap.js";

export const selectedCustomEntries = new Set();

export function syncCustomSelectionUI() {
  customTreeItems?.querySelectorAll(".custom-entry-row[data-custom-path]").forEach((row) => {
    const selected = selectedCustomEntries.has(row.dataset.customPath);
    row.classList.toggle("selected", selected);
    row.querySelector(".custom-entry")?.setAttribute("aria-selected", String(selected));
  });
}

export function selectCustomEntry(event, entry, { contextMenu = false } = {}) {
  if (entry.source !== "custom") return;
  const pathValue = entry.relativePath;
  const additive = event.ctrlKey || event.metaKey;
  const rows = [...customTreeItems.querySelectorAll(".custom-entry-row[data-custom-path]")];
  const ordered = rows.map((row) => row.dataset.customPath);
  if (event.shiftKey && appState.customSelectionAnchor && ordered.includes(appState.customSelectionAnchor)) {
    const start = ordered.indexOf(appState.customSelectionAnchor); const end = ordered.indexOf(pathValue);
    if (!additive) selectedCustomEntries.clear();
    ordered.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((item) => selectedCustomEntries.add(item));
  } else if (additive) {
    if (selectedCustomEntries.has(pathValue)) selectedCustomEntries.delete(pathValue); else selectedCustomEntries.add(pathValue);
    appState.customSelectionAnchor = pathValue;
  } else if (!contextMenu || !selectedCustomEntries.has(pathValue)) {
    selectedCustomEntries.clear(); selectedCustomEntries.add(pathValue); appState.customSelectionAnchor = pathValue;
  }
  if (entry.type === "directory") appState.selectedCustomFolder = pathValue;
  syncCustomSelectionUI();
}

export function closeCustomContextMenu() {
  if (customContextMenu) customContextMenu.hidden = true;
}

export function openCustomContextMenu(event, entry) {
  if (!customContextMenu || entry.source !== "custom") return;
  event.preventDefault(); event.stopPropagation(); selectCustomEntry(event, entry, { contextMenu: true });
  const count = selectedCustomEntries.size;
  customContextDeleteLabel.textContent = count === 1 ? "Delete" : `Delete ${count} Items`;
  customContextMenu.hidden = false;
  const width = customContextMenu.offsetWidth || 190; const height = customContextMenu.offsetHeight || 34;
  customContextMenu.style.left = `${Math.max(4, Math.min(event.clientX, window.innerWidth - width - 4))}px`;
  customContextMenu.style.top = `${Math.max(34, Math.min(event.clientY, window.innerHeight - height - 4))}px`;
  customContextDelete?.focus();
}

export async function deleteSelectedCustomEntries() {
  const relativePaths = [...selectedCustomEntries];
  if (!relativePaths.length || !appState.assessmentPath || appState.deletingCustomEntries) return;
  releaseWorkspaceMutationFocus();
  const currentPath = String(appState.resourceCurrentFilePath || "").replace(/\\/g, "/").toLowerCase();
  const deletedCurrentResource = relativePaths.some((item) => {
    const target = assessmentDiskPath(`custom/${item}`).replace(/\\/g, "/").toLowerCase();
    return currentPath === target || currentPath.startsWith(`${target}/`);
  });
  appState.deletingCustomEntries = true;
  if (customContextDelete) customContextDelete.disabled = true;
  try {
    const result = await window.api.assessmentDeleteEntries({ path: appState.assessmentPath, relativePaths });
    if (result?.error) {
      await AppDialog.alert(`Delete failed: ${result.error}`, { title: "Delete failed" });
      return;
    }
    if (appState.selectedCustomFolder && relativePaths.some((item) => appState.selectedCustomFolder === item || appState.selectedCustomFolder.startsWith(`${item}/`))) appState.selectedCustomFolder = "";
    selectedCustomEntries.clear(); appState.customSelectionAnchor = "";
    if (deletedCurrentResource) {
      setResourceDirty(false); appState.resourceCurrentFilePath = ""; appState.resourcePreviewText = ""; appState.resourceSavedText = "";
      resourceViewerContent.value = ""; resourceViewerContent.hidden = true; resourceViewerEmpty.hidden = false; resourceViewerTitle.textContent = "Target workspace"; resourceViewerMeta.textContent = "The selected Custom item was deleted."; resourceViewerCopy.disabled = true; settingsViewSwitch.hidden = true; settingsUIView.hidden = true; checklistUIView.hidden = true; scopeUIView.hidden = true;
    }
    await refreshCustomEntries();
    await refreshWorkspaceUi();
  } catch (error) {
    await AppDialog.alert(`Delete failed: ${error?.message || "Unexpected workspace error"}`, { title: "Delete failed" });
  } finally {
    appState.deletingCustomEntries = false;
    if (customContextDelete) customContextDelete.disabled = selectedCustomEntries.size === 0;
    closeCustomContextMenu();
    restoreChatComposerAfterUiAction();
  }
}

export async function refreshCustomEntries() {
  if (!customTreeItems || !appState.assessmentPath) return;
  const result = await window.api.assessmentCustomEntries({ path: appState.assessmentPath });
  customTreeItems.innerHTML = "";
  let toolsLabelAdded = false;
  const entries = result?.entries || [];
  const selectablePaths = new Set(entries.filter((entry) => entry.source === "custom").map((entry) => entry.relativePath));
  for (const selected of selectedCustomEntries) if (!selectablePaths.has(selected)) selectedCustomEntries.delete(selected);
  const customFolders = new Set(entries.filter((entry) => entry.source === "custom" && entry.type === "directory").map((entry) => entry.relativePath));
  if (appState.selectedCustomFolder && !customFolders.has(appState.selectedCustomFolder)) appState.selectedCustomFolder = "";
  entries.forEach((entry) => {
    if (entry.source === "tools" && !toolsLabelAdded) {
      toolsLabelAdded = true;
      const label = document.createElement("div"); label.className = "custom-inline-label"; label.textContent = "Tool Results"; customTreeItems.appendChild(label);
    }
    const row = document.createElement("div"); row.className = "custom-entry-row"; row.style.paddingLeft = `${8 + (entry.relativePath.split("/").length - 1) * 14}px`;
    if (entry.source === "custom") row.dataset.customPath = entry.relativePath;
    const button = document.createElement("button"); button.type = "button"; button.className = "bounty-report-item custom-entry";
    const icon = document.createElement("span"); icon.className = `codicon ${entry.type === "directory" ? "codicon-folder" : "codicon-file"}`;
    const name = document.createElement("span"); name.textContent = entry.name; button.append(icon, name); row.appendChild(button);
    if (entry.source === "tools" && entry.relativePath.split("/").length === 1) row.classList.add("tool-result-root");
    if (entry.type === "file") button.addEventListener("click", (event) => {
      if (entry.source === "custom") selectCustomEntry(event, entry);
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) showResourcePreview(assessmentDiskPath(`${entry.source}/${entry.relativePath}`), entry.name, `${entry.source === "tools" ? "Tool Results" : "Custom"} / ${entry.relativePath}`, { icon: "codicon-file" });
    });
    if (entry.type === "directory" && entry.source === "custom") {
      row.classList.toggle("creation-target", entry.relativePath === appState.selectedCustomFolder);
      button.addEventListener("click", (event) => selectCustomEntry(event, entry));
      const actions = document.createElement("span"); actions.className = "custom-folder-actions";
      [["file", "codicon-new-file", "New file in folder"], ["directory", "codicon-new-folder", "New subfolder"]].forEach(([type, iconName, title]) => {
        const action = document.createElement("button"); action.type = "button"; action.className = "custom-folder-action"; action.title = title; action.setAttribute("aria-label", title); action.innerHTML = `<span class="codicon ${iconName}"></span>`;
        action.addEventListener("click", (event) => { event.stopPropagation(); appState.selectedCustomFolder = entry.relativePath; beginCustomEntry(type, entry.relativePath, row); }); actions.appendChild(action);
      });
      row.appendChild(actions);
    }
    if (entry.source === "custom") row.addEventListener("contextmenu", (event) => openCustomContextMenu(event, entry));
    customTreeItems.appendChild(row);
  });
  syncCustomSelectionUI();
}
export function beginCustomEntry(type, parentRelative = appState.selectedCustomFolder, anchorRow = null) {
  if (!appState.assessmentPath || !customTreeItems) return;
  customTreeItems.querySelector(".custom-create-row")?.remove();
  const row = document.createElement("div"); row.className = "custom-create-row";
  const parent = String(parentRelative || "").replace(/^\/+|\/+$/g, "");
  row.style.paddingLeft = `${9 + (parent ? parent.split("/").length * 14 : 0)}px`;
  const icon = document.createElement("span"); icon.className = `codicon ${type === "directory" ? "codicon-folder" : "codicon-file"}`;
  const input = document.createElement("input"); input.type = "text"; input.className = "custom-create-input"; input.placeholder = type === "directory" ? "folder-name" : "filename.ext"; input.setAttribute("aria-label", type === "directory" ? "New custom folder name" : "New custom file name"); input.autocomplete = "off"; input.spellcheck = false;
  row.append(icon, input); if (anchorRow?.isConnected) anchorRow.after(row); else customTreeItems.prepend(row);
  let committing = false;
  const cancel = () => { if (!committing && row.isConnected) row.remove(); };
  const commit = async () => {
    const name = input.value.trim();
    if (!name) { cancel(); return; }
    committing = true; input.disabled = true; row.classList.add("creating");
    const relativeName = parent ? `${parent}/${name}` : name;
    const result = await window.api.assessmentCreateEntry({ path: appState.assessmentPath, relativePath: `custom/${relativeName}`, type });
    if (result?.error) {
      committing = false; input.disabled = false; row.classList.remove("creating"); row.classList.add("error"); input.title = result.error; input.focus(); input.select(); return;
    }
    if (type === "directory") appState.selectedCustomFolder = relativeName;
    await refreshCustomEntries();
    if (type === "file" && result.path) await showResourcePreview(result.path, name.split(/[\\/]/).pop(), `Custom / ${relativeName}`, { icon: "codicon-file" });
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
  });
  input.addEventListener("input", () => { row.classList.remove("error"); input.removeAttribute("title"); });
  input.addEventListener("blur", () => setTimeout(cancel, 120));
  requestAnimationFrame(() => input.focus());
}
