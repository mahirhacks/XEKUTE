import { appState } from "../../core/app-state.js";
import {
  activityTerminal, btnTopTerminal, terminalPane, terminalResize, centerPanel, editorPane,
  btnTerminalMaximize,
} from "../../core/dom-refs.js";
import { EditorManager, TerminalManager } from "../../core/runtime-globals.js";
import { EDITOR_MIN_HEIGHT } from "../layout/panel-resize.js";

export const TERMINAL_HEADER_H = 35;
export const TERMINAL_MIN_EXPANDED = 80;

export function setTerminalCollapsed(collapsed, { createIfMissing = true } = {}) {
  if (collapsed && appState.terminalMaximized) {
    appState.terminalMaximized = false;
    centerPanel.classList.remove("terminal-maximized");
    syncTerminalMaximizeButton();
  }
  appState.terminalCollapsed = collapsed;
  terminalPane.classList.toggle("collapsed", collapsed);
  terminalResize.classList.toggle("collapsed-hint", collapsed);
  btnTopTerminal?.classList.toggle("active", !collapsed);
  btnTopTerminal?.classList.toggle("inactive", collapsed);
  btnTopTerminal?.setAttribute("aria-pressed", String(!collapsed));
  activityTerminal?.classList.toggle("panel-visible", !collapsed);
  activityTerminal?.setAttribute("aria-pressed", String(!collapsed));
  TerminalManager.setPanelOpen?.(!collapsed);

  if (collapsed) {
    if (terminalPane.offsetHeight > TERMINAL_MIN_EXPANDED) {
      appState.terminalSavedHeight = terminalPane.offsetHeight;
    }
    terminalPane.style.height = "0px";
    terminalPane.style.flex = "none";
    editorPane.style.flex = "1";
    editorPane.style.height = "";
  } else {
    const centerH = centerPanel.getBoundingClientRect().height;
    const sashH = terminalResize.offsetHeight || 0;
    const availableH = Math.max(0, centerH - sashH);
    appState.terminalSavedHeight = Math.min(
      Math.max(TERMINAL_MIN_EXPANDED, appState.terminalSavedHeight),
      Math.max(TERMINAL_MIN_EXPANDED, availableH - EDITOR_MIN_HEIGHT),
    );
    terminalPane.style.height = `${appState.terminalSavedHeight}px`;
    terminalPane.style.flex = "none";
    editorPane.style.flex = "none";
    const editorH = Math.max(EDITOR_MIN_HEIGHT, availableH - appState.terminalSavedHeight);
    editorPane.style.height = `${editorH}px`;
    requestAnimationFrame(() => {
      EditorManager.layout();
      TerminalManager.fitActive();
    });
    if (createIfMissing && !TerminalManager.hasSessions()) {
      TerminalManager.ensureTerminal();
    }
  }
}

export function syncTerminalMaximizeButton() {
  if (!btnTerminalMaximize) return;
  const icon = btnTerminalMaximize.querySelector(".codicon");
  icon?.classList.toggle("codicon-chevron-up", !appState.terminalMaximized);
  icon?.classList.toggle("codicon-chevron-down", appState.terminalMaximized);
  btnTerminalMaximize.title = appState.terminalMaximized ? "Restore Panel Size" : "Maximize Panel";
  btnTerminalMaximize.setAttribute("aria-pressed", String(appState.terminalMaximized));
}

export function setTerminalMaximized(maximized) {
  const next = Boolean(maximized);
  if (next && appState.terminalCollapsed) setTerminalCollapsed(false);
  appState.terminalMaximized = next;
  centerPanel.classList.toggle("terminal-maximized", appState.terminalMaximized);
  syncTerminalMaximizeButton();

  if (!appState.terminalMaximized) {
    const centerH = centerPanel.getBoundingClientRect().height;
    const sashH = terminalResize.offsetHeight || 0;
    const availableH = Math.max(0, centerH - sashH);
    appState.terminalSavedHeight = Math.min(
      Math.max(TERMINAL_MIN_EXPANDED, appState.terminalSavedHeight),
      Math.max(TERMINAL_MIN_EXPANDED, availableH - EDITOR_MIN_HEIGHT),
    );
    terminalPane.style.height = `${appState.terminalSavedHeight}px`;
    terminalPane.style.flex = "none";
    editorPane.style.height = `${Math.max(EDITOR_MIN_HEIGHT, availableH - appState.terminalSavedHeight)}px`;
    editorPane.style.flex = "none";
  } else {
    terminalPane.style.height = "";
    terminalPane.style.flex = "1 1 auto";
    editorPane.style.height = "";
    editorPane.style.flex = "1";
  }

  requestAnimationFrame(() => {
    EditorManager.layout();
    TerminalManager.fitActive();
  });
}

export function scheduleTerminalDragLayout() {
  if (appState.terminalDragLayoutFrame) return;
  appState.terminalDragLayoutFrame = requestAnimationFrame(() => {
    appState.terminalDragLayoutFrame = 0;
    EditorManager.layout();
  });
}

export function applyTerminalHeight(value) {
  if (appState.terminalMaximized) setTerminalMaximized(false);
  if (appState.terminalCollapsed) setTerminalCollapsed(false);
  const centerH = centerPanel.getBoundingClientRect().height;
  const sashH = terminalResize.offsetHeight || 0;
  const availableH = Math.max(0, centerH - sashH);
  appState.terminalSavedHeight = Math.max(96, Math.min(availableH - EDITOR_MIN_HEIGHT, value));
  terminalPane.style.height = `${appState.terminalSavedHeight}px`;
  terminalPane.style.flex = "none";
  editorPane.style.height = `${Math.max(EDITOR_MIN_HEIGHT, availableH - appState.terminalSavedHeight)}px`;
  editorPane.style.flex = "none";
  terminalResize.setAttribute("aria-valuenow", String(Math.round(appState.terminalSavedHeight)));
  requestAnimationFrame(() => { EditorManager.layout(); TerminalManager.fitActive(); });
}
