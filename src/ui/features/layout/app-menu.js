import { appMenu, helpGuideOverlay, helpGuideClose, resourceViewer } from "../../core/dom-refs.js";
import { EditorManager, TerminalManager } from "../../core/runtime-globals.js";
import {
  updateRunMenuState, configureRunCommand, runConfiguredCommand,
} from "../project/run-commands.js";
import { appState } from "../../core/app-state.js";
import { setChatCollapsed, openChatPane, newChatSession } from "../chat/chat-sessions.js";
import { openAppSettings } from "../settings/app-settings-shell.js";
import {
  createProject, openProject, openFolder, openFileDialog,
} from "../project/project-activation.js";
import { createNewItemInput } from "../project/explorer-tree.js";
import { saveResourceChanges } from "../assessment/resource-viewer.js";
import { saveActiveTab, closeTab } from "../editor/editor-tabs.js";
import { showSecurityWorkspace, activateSidebarView } from "./workspace-switcher.js";
import { setUiZoom } from "./panel-resize.js";
import { runUpdateCheck, openQuickPalette } from "../../bootstrap.js";
import { setTerminalCollapsed } from "../terminal/terminal-panel.js";

export function syncMinimapMenu() {
  const button = appMenu?.querySelector('[data-action="toggle-minimap"]');
  if (!button) return;
  const enabled = Boolean(EditorManager?.isMinimapEnabled?.());
  button.textContent = enabled ? "Hide Minimap" : "Show Minimap";
  button.setAttribute("aria-checked", String(enabled));
}

export function showHelpGuide() {
  closeAppMenus();
  if (!helpGuideOverlay) return;
  helpGuideOverlay.hidden = false;
  helpGuideClose?.focus();
}

export function closeHelpGuide() {
  if (helpGuideOverlay) helpGuideOverlay.hidden = true;
}

export function closeAppMenus() {
  appMenu?.querySelectorAll(".app-menu-dropdown").forEach((panel) => {
    panel.hidden = true;
  });
  appMenu?.querySelectorAll(".app-menu-button.active").forEach((button) => {
    button.classList.remove("active");
    button.setAttribute("aria-expanded", "false");
  });
}

export function toggleAppMenu(name) {
  if (!appMenu) return;
  const panel = appMenu.querySelector(`[data-menu-panel="${CSS.escape(name)}"]`);
  const button = appMenu.querySelector(`[data-menu="${CSS.escape(name)}"]`);
  if (!panel || !button) return;
  const opening = panel.hidden;
  closeAppMenus();
  panel.hidden = !opening;
  button.classList.toggle("active", opening);
  button.setAttribute("aria-expanded", String(opening));
  if (name === "run") updateRunMenuState();
}

export async function runMenuAction(action) {
  const focusedActions = new Set([
    "new-file",
    "new-folder",
    "new-terminal",
    "clear-terminal",
    "kill-terminal",
    "toggle-terminal",
    "toggle-chat",
    "command-palette",
    "quick-open",
    "workspace-search",
    "create-project",
    "open-project",
    "open-file",
    "save-file",
    "close-editor",
    "open-folder",
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "select-all",
    "zoom-in",
    "zoom-out",
    "zoom-reset",
    "toggle-minimap",
    "show-project",
    "show-security",
    "show-settings",
    "help-guide",
    "new-chat",
    "about",
    "configure-run",
        "run-code",
        "check-updates",
      ]);
  if (!focusedActions.has(action)) return;
  switch (action) {
    case "new-file":
      if (!appState.rootPath) {
        await AppDialog.alert("Open a folder first.", { title: "Folder required" });
        return;
      }
      createNewItemInput(false);
      break;
    case "new-folder":
      if (!appState.rootPath) {
        await AppDialog.alert("Open a folder first.", { title: "Folder required" });
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
    case "undo":
    case "redo":
    case "cut":
    case "copy":
    case "paste":
      document.execCommand(action);
      break;
    case "toggle-terminal":
      setTerminalCollapsed(!appState.terminalCollapsed);
      break;
    case "toggle-chat":
      if (appState.chatCollapsed) openChatPane({ createIfEmpty: true });
      else setChatCollapsed(true);
      break;
    case "command-palette":
      openQuickPalette("command");
      break;
    case "quick-open":
      openQuickPalette("file");
      break;
    case "workspace-search":
      openQuickPalette("search");
      break;
    case "create-project":
      createProject();
      break;
    case "open-project":
      openProject();
      break;
    case "save-file":
      if (appState.resourceCurrentFilePath && resourceViewer && !resourceViewer.hidden) saveResourceChanges();
      else saveActiveTab();
      break;
    case "close-editor":
      if (appState.activeTabPath) closeTab(appState.activeTabPath);
      break;
    case "select-all":
      document.execCommand("selectAll");
      break;
    case "zoom-in":
      setUiZoom(appState.uiZoom + 0.1);
      break;
    case "zoom-out":
      setUiZoom(appState.uiZoom - 0.1);
      break;
    case "zoom-reset":
      setUiZoom(1);
      break;
    case "toggle-minimap":
      EditorManager?.toggleMinimap?.();
      syncMinimapMenu();
      break;
    case "show-project":
      activateSidebarView("project");
      break;
    case "show-security":
      showSecurityWorkspace();
      break;
    case "show-settings":
      openAppSettings();
      break;
    case "help-guide":
          showHelpGuide();
          break;
        case "check-updates":
          runUpdateCheck(true);
          break;
    case "new-chat":
      newChatSession();
      break;
    case "about":
      await AppDialog.alert("XEKUTE — local-first penetration testing and vulnerability assessment workspace", { title: "About XEKUTE" });
      break;
    case "configure-run":
      configureRunCommand();
      break;
    case "run-code":
      runConfiguredCommand();
      break;
    default:
      break;
  }
}
