import {
  toolCardLabelText, isStubToolStatusLabel, syncToolCardPlaceholderVisibility,
  isTransientToolCardLabel, keepableToolCardLabel, isKeepableToolCard,
} from "./chat-persistence.js";
import {
  isPlaceholderTarget, stackVerbForLabel, absorbFileRow, assistantStreamHost,
  appendChatStreamNode, restackFileRows,
} from "./turn-structure.js";
import {
  splitToolStatusLabel, toolActionName, isFileActionTool, toolCardKey, toolTargetPath,
  toolDisplayName, fileActionKindForTool, renderToolStatusLabel, exploredToolParts,
  exploredToolLabel, isBareToolVerbLabel, decorateBareToolLabel, renderToolStatusLabelFromText,
  toolTargetBasename, toolCardFileKey, isAskQuestionsTool, isEndTurnTool, toolUiResult,
  minimalToolSuccessLabel,
} from "./tool-labels.js";
import { activeChatRuns } from "./chat-run-state.js";
import {
  openTabs, openFile, isMarkdownFileName, renderTabs, renderEditor, closeTab,
} from "../../bootstrap.js";
import { refreshWorkspaceUi, reconcileDeletedWorkspacePath } from "../project/explorer-tree.js";
import { loadGuidanceSettings } from "../settings/guidance-settings.js";
import { startWaitCardTicker } from "../agents/background-waits.js";
import { isTaskListTool } from "./composer-questions.js";
import { isAgentTerminalTool, agentTerminalCommandForTool } from "./command-timeline.js";
import { appState } from "../../core/app-state.js";
import { EditorManager, TerminalManager } from "../../core/runtime-globals.js";
import { normPath, joinWorkspacePath } from "../../core/workspace-paths.js";
import { createQuestionAnswerCard, questionAnswerRecord } from "./question-answers.js";
import { syncActiveChatSession } from "./chat-sessions.js";
import { scrollMessages } from "./chat-messages.js";

// Only rows for workspace files open in the editor. Browser, replay, identity,
// search and delegation rows describe actions, not files; deleted files and
// new folders have nothing to open.
export const FILE_ROW_ACTIONS = new Set(["read_file", "apply_patch"]);

export function toolRowOpensFile(row) {
  const path = String(row?.dataset?.path || "").trim();
  if (!path || isPlaceholderTarget(path) || /^[a-z]+:\/\//i.test(path)) return false;
  if (!FILE_ROW_ACTIONS.has(String(row.dataset.toolAction || ""))) return false;
  const verb = splitToolStatusLabel(toolCardLabelText(row)).verb;
  return !/^(Deleting|Deleted|Creating folder|Created folder|Failed)$/i.test(verb);
}

export function syncToolRowOpensFile(row) {
  if (row?.dataset) row.dataset.opensFile = String(toolRowOpensFile(row));
  return row;
}

export function createToolCard(tool, { pending = false } = {}) {
  const card = document.createElement("button");
  card.type = "button";
  const fileAction = isFileActionTool(tool);
  card.className = `agent-file-row tool-card${pending ? " pending" : ""}${fileAction ? " file-action" : ""}`;
  card.dataset.lane = "activity";
  const displayName = toolDisplayName(tool);
  const callId = String(tool.callId || "").trim();
  const path = toolTargetPath(tool);
  card.dataset.file = displayName;
  if (path && !isPlaceholderTarget(path)) card.dataset.path = path;
  card.dataset.toolAction = toolActionName(tool);
  card.dataset.toolKey = toolCardKey(tool);
  if (callId) card.dataset.callId = callId;
  card.dataset.fileActionKind = fileActionKindForTool(tool);
  card.dataset.runningLabel = exploredToolLabel(tool, {}, "running");
  card.dataset.completedLabel = exploredToolLabel(tool, {}, "success");
  card.dataset.state = pending ? "queued" : "running";
  const runningParts = exploredToolParts(tool, {}, "running");
  card.dataset.fileVerb = stackVerbForLabel(runningParts.verb);
  const fileEl = document.createElement("span");
  fileEl.className = "tool-card-file";
  if (!isStubToolStatusLabel(runningParts.verb)) {
    renderToolStatusLabel(fileEl, runningParts.verb, runningParts.detail);
  }
  card.appendChild(fileEl);
  card.setAttribute("aria-label", card.dataset.runningLabel);
  return syncToolCardPlaceholderVisibility(card);
}

export function setToolCardStatus(card, type, message) {
  if (!card) return;
  if (type === "error") {
    card.remove();
    return;
  }
  const fileEl = card.querySelector(".tool-card-file");
  let label = type === "running"
    ? card.dataset.runningLabel || ""
    : String(message || card.dataset.completedLabel || "").trim();
  label = decorateBareToolLabel(card, label);
  if (!label || isStubToolStatusLabel(label) || isBareToolVerbLabel(label) || (type === "success" && isTransientToolCardLabel(label))) {
    const recovered = [card.dataset.completedLabel, card.dataset.runningLabel, toolCardLabelText(card)]
      .map((value) => decorateBareToolLabel(card, value))
      .find((value) => keepableToolCardLabel(value));
    if (recovered) label = recovered;
    else if (type === "success") {
      card.remove();
      return;
    } else {
      if (fileEl) fileEl.replaceChildren();
      card.dataset.state = "running";
      card.classList.add("pending");
      card.hidden = true;
      return;
    }
  }
  if (fileEl) renderToolStatusLabelFromText(fileEl, label);
  syncToolRowOpensFile(card);
  const parts = splitToolStatusLabel(label);
  if (parts.verb) card.dataset.fileVerb = stackVerbForLabel(parts.verb);
  card.dataset.state = type;
  card.classList.toggle("pending", type === "running");
  card.setAttribute("aria-label", label);
  card.classList.remove("status-updated");
  void card.offsetWidth;
  card.classList.add("status-updated");
  const status = card.querySelector(".tool-card-status");
  if (status) {
    status.className = `tool-card-status ${type}`;
    status.textContent = "";
  }
  syncToolCardPlaceholderVisibility(card);
  if (card.isConnected) absorbFileRow(card);
}

// Timeline rows (Read / Edited / Searched / commands) stay in the Tool Used
// fold. Only unlabeled transient stubs are eligible to auto-fade.
export const TOOL_CARD_FADE_MS = 900;
export const TOOL_CARD_KEEP_MUTATION = new Set(["create_guidance"]);
export function shouldAutoFadeToolCard(card) {
  if (!card) return false;
  if (card.dataset.state === "error") return false;
  if (isKeepableToolCard(card)) return false;
  if (TOOL_CARD_KEEP_MUTATION.has(card.dataset.toolAction)) return false;
  return true;
}
export function fadeToolCard(card) {
  if (!card || !card.isConnected || card.dataset.faded) return;
  if (card.dataset.state !== "success") return;
  if (!shouldAutoFadeToolCard(card)) return;
  card.dataset.faded = "1";
  card.classList.add("tool-card-fade");
  card.setAttribute("aria-label", `${card.dataset.runningLabel || "Tool"} done`);
  setTimeout(() => {
    card.classList.add("tool-card-fade-collapse");
    setTimeout(() => card.remove(), 320);
  }, TOOL_CARD_FADE_MS);
}

export function markAssistantToolUse(turn) {
  if (!turn) return null;
  for (const run of activeChatRuns.values()) {
    const assistant = run.assistant;
    if (!assistant) continue;
    if (assistant.turn === turn || assistant.rootTurn === turn || assistant.assistantTurns?.().includes(turn)) {
      assistant.markToolUse();
      return assistant;
    }
  }
  return null;
}

export function toolCardMountHost(turn, contentEl, assistant) {
  const work = assistant?.toolWorkMount?.() || assistantStreamHost(turn);
  if (work && !work.classList?.contains("assistant-reply")) return work;
  const parent = contentEl?.parentElement;
  if (parent && !parent.classList.contains("assistant-reply")) return parent;
  return turn;
}

export function ensureToolCard(turn, contentEl, tool, { pending = false } = {}) {
  if (!tool || isAskQuestionsTool(tool) || isEndTurnTool(tool) || isTaskListTool(tool) || isAgentTerminalTool(tool)) return null;
  const assistant = markAssistantToolUse(turn);
  const fileKey = toolCardFileKey(tool);
  const action = toolActionName(tool);
  const callId = String(tool.callId || "").trim();
  const key = toolCardKey(tool);
  const targetPath = toolTargetPath(tool);
  const cards = [...(turn?.closest?.(".chat-exchange") || assistant?.workHostTurn?.() || turn).querySelectorAll(".tool-card")];
  let card = cards.find((candidate) => callId && candidate.dataset.callId === callId)
    || cards.find((candidate) => candidate.dataset.toolKey === key)
    || cards.find((candidate) => candidate.dataset.toolAction === action && (
      candidate.dataset.file === fileKey
      || (targetPath && candidate.dataset.path === targetPath)
    ))
    || (action === "create_guidance" ? cards.find((candidate) => candidate.dataset.toolAction === action) : null);
  const runningLabel = exploredToolLabel(tool, {}, "running");
  const completedLabel = exploredToolLabel(tool, {}, "success");
  const host = toolCardMountHost(turn, contentEl, assistant);
  let mounted = false;
  if (!card) {
    assistant?.sealCurrentContentSegment?.();
    card = createToolCard(tool, { pending });
    appendChatStreamNode(host, card);
    mounted = true;
  } else if (!card.isConnected || card.closest(".assistant-reply")) {
    assistant?.sealCurrentContentSegment?.();
    appendChatStreamNode(host, card);
    mounted = true;
  }
  // fileKey can fall back to the tool name (`browser_action`) for matching;
  // the row's file is only ever a real target path.
  card.dataset.file = toolDisplayName(tool) || (!isPlaceholderTarget(targetPath) ? toolTargetBasename({ args: { path: targetPath } }, {}) : "");
  card.dataset.toolAction = action;
  card.dataset.toolKey = key;
  if (targetPath && !isPlaceholderTarget(targetPath)) card.dataset.path = targetPath;
  card.dataset.fileActionKind = card.dataset.fileActionKind || fileActionKindForTool(tool);
  if (callId) card.dataset.callId = callId;
  card.dataset.runningLabel = runningLabel;
  card.dataset.completedLabel = completedLabel;
  if (card.dataset.state !== "success") {
    card.classList.toggle("pending", pending);
    setToolCardStatus(card, "running", runningLabel);
  } else {
    syncToolCardPlaceholderVisibility(card);
  }
  if (mounted) {
    absorbFileRow(card);
    assistant?.ensurePostToolContentSegment?.();
  }
  return card;
}

export async function applyEditToEditor(tool, newContent, previousContent = null, { openIfMissing = true, preserveDirty = true } = {}) {
  if (newContent == null) return;

  const filePath = joinWorkspacePath(tool.file);
  const fileName = tool.file.split(/[/\\]/).pop();
  const tabPath = normPath(filePath);

  if (openTabs.has(tabPath)) {
    const tab = openTabs.get(tabPath);
    const before = previousContent ?? tab.content ?? tab.savedContent ?? "";
    if (preserveDirty && tab.dirty) {
      tab.savedContent = newContent;
      tab.dirty = tab.content !== tab.savedContent;
      renderTabs();
      return { updated: !tab.dirty, preservedDirty: tab.dirty };
    }
    tab.content = newContent;
    tab.savedContent = newContent;
    tab.dirty = false;
    tab.error = null;
    renderTabs();
    if (appState.activeTabPath === tabPath) {
      appState.editorLoadedPath = null;
      await renderEditor({ focusEditor: false });
      if (!(isMarkdownFileName(tab.name) && appState.markdownViewMode === "md")) {
        await EditorManager.showChangeDecorations(tabPath, before, newContent);
      }
    }
    return { updated: true, preservedDirty: false };
  } else {
    if (!openIfMissing) return { updated: false, preservedDirty: false };
    const before = previousContent ?? "";
    await openFile(filePath, fileName);
    const tab = openTabs.get(tabPath);
    if (tab) {
      tab.content = newContent;
      tab.savedContent = newContent;
      tab.dirty = false;
    }
    if (appState.activeTabPath === tabPath) {
      appState.editorLoadedPath = null;
      await renderEditor({ focusEditor: false });
      await EditorManager.showChangeDecorations(tabPath, before, newContent);
    }
    return { updated: true, preservedDirty: false };
  }
}

export function canonicalApplyPatchFileStates(tool, result) {
  if (toolActionName(tool) !== "apply_patch" || result?.ok === false || result?.value?.dryRun) return null;
  const changes = Array.isArray(result?.value?.changes) ? result.value.changes : null;
  if (!changes) return null;

  const states = new Map();
  for (const change of changes) {
    const path = String(change?.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!path || path === ".") continue;
    if (change.kind === "move") {
      const target = String(change.target || "").replace(/\\/g, "/").replace(/^\/+/, "");
      states.set(path, "missing");
      if (target) states.set(target, "file");
    } else if (change.kind === "delete") {
      states.set(path, "missing");
    } else if (change.kind === "ensure_dir") {
      states.set(path, "directory");
    } else if (change.kind === "create" || change.kind === "modify") {
      states.set(path, "file");
    }
  }
  return states;
}

export async function syncCanonicalApplyPatchToEditor(tool, result) {
  const fileStates = canonicalApplyPatchFileStates(tool, result);
  if (!fileStates) return false;

  const preferredPath = [...fileStates].find(([, state]) => state === "file")?.[0] || "";
  await refreshWorkspaceUi({
    preserveSelectionPath: preferredPath ? joinWorkspacePath(preferredPath) : appState.selectedItem?.dataset.path || null,
  });

  for (const [relativePath, state] of fileStates) {
    const absolutePath = joinWorkspacePath(relativePath);
    const tabPath = normPath(absolutePath);
    const tab = openTabs.get(tabPath);

    if (state !== "file") {
      appState.contextFilesCache = appState.contextFilesCache.filter((file) => file.path !== relativePath && !file.path.startsWith(`${relativePath}/`));
      if (tab && !tab.dirty) await closeTab(tabPath, null, { force: true });
      continue;
    }

    if (!tab && !appState.contextFilesCache.some((file) => file.path === relativePath)) continue;
    const diskResult = await window.api.readFile(absolutePath);
    if (diskResult?.error || diskResult?.content == null) continue;
    const diskContent = String(diskResult.content);
    const previousContent = tab?.savedContent ?? appState.contextFilesCache.find((file) => file.path === relativePath)?.content ?? "";
    appState.contextFilesCache = appState.contextFilesCache.filter((file) => file.path !== relativePath);
    appState.contextFilesCache.push({ path: relativePath, content: diskContent });
    if (tab) {
      await applyEditToEditor(
        { ...tool, file: relativePath },
        diskContent,
        previousContent,
        { openIfMissing: false, preserveDirty: true },
      );
    }
  }
  return true;
}

export async function applyToolResultToUi(tool, result, turn, contentEl) {
  if (isAskQuestionsTool(tool)) {
    // The row goes into the work flow where the agent asked; later prose and
    // work render after it.
    const card = result?.error ? null : createQuestionAnswerCard(questionAnswerRecord(tool, result));
    if (card) toolCardMountHost(turn, contentEl, markAssistantToolUse(turn)).appendChild(card);
    scrollMessages();
    return;
  }
  if (isEndTurnTool(tool) || isTaskListTool(tool)) return;
  const card = ensureToolCard(turn, contentEl, tool);
  if (!card) return;

  if (result?.error) {
    setToolCardStatus(card, "error", result.error);
    scrollMessages();
    return;
  }

  const badge = card.querySelector(".tool-card-badge");
  if (badge) {
    badge.textContent = ToolParser.toolCardDetail(tool);
  }

  let successText = minimalToolSuccessLabel(tool, result);
  const uiResult = toolUiResult(result);
  const resultPath = toolTargetPath(tool, uiResult);
  if (resultPath && !isPlaceholderTarget(resultPath)) card.dataset.path = resultPath;
  const displayName = toolDisplayName(tool, uiResult)
    || (!isPlaceholderTarget(resultPath) ? toolTargetBasename({ args: { path: resultPath } }, {}) : "");
  if (displayName) card.dataset.file = displayName;
  card.dataset.completedLabel = successText;
  if (result?.terminalId && result.showInTerminal !== false) {
    successText = result.mode === "terminal_wait" || result.mode === "subagent_wait" ? "waiting" : "Terminal ready";
    TerminalManager.attachAgentSession({
      id: result.terminalId,
      command: result.command || tool.command || agentTerminalCommandForTool(tool),
      toolName: tool.toolName || tool.action || "exec_command",
    });
    globalThis.expandTerminalPanel?.({ createIfMissing: false });
  }

  setToolCardStatus(card, "success", successText);

  if (result.mode === "subagent_wait" || result.mode === "terminal_wait") {
    card.classList.remove("pending");
    card.dataset.state = "waiting";
    card.classList.add("subagent-wait");
    const waitId = String(result.subagentId || result.waitId || result.processId || result.terminalId || "");
    const waitMs = Number(result.waitMs) > 0 ? Number(result.waitMs) : 0;
    card.dataset.subagentId = waitId;
    card.dataset.waitId = waitId;
    card.dataset.waitKind = result.mode === "subagent_wait" ? "subagent" : "terminal";
    card.dataset.waitStartedAt = String(Number(result.startedAt) || Date.now());
    card.dataset.waitMs = String(waitMs);
    startWaitCardTicker(card);
    const status = card.querySelector(".tool-card-status");
    if (status) {
      status.className = "tool-card-status running";
      status.textContent = "";
    }
    scrollMessages();
    return;
  }

  fadeToolCard(card);

  if ((tool.toolName || tool.action) === "create_guidance" && result.guidancePath) {
    appState.selectedGuidancePath = result.guidancePath;
    appState.selectedGuidanceScope = result.scope || "project";
    appState.selectedGuidanceContent = String(result.content || "");
    appState.guidanceDraft = null;
    await loadGuidanceSettings({ preserveSelection: true });
  }

  if (result.mode === "read" && result.file && result.content != null) {
    appState.contextFilesCache = appState.contextFilesCache.filter((file) => file.path !== result.file);
    appState.contextFilesCache.push({ path: result.file, content: result.content });
  }

  const canonicalPatchSynced = await syncCanonicalApplyPatchToEditor(tool, result);
  if (!canonicalPatchSynced && result.mode === "delete" && result.file) {
    await reconcileDeletedWorkspacePath(joinWorkspacePath(result.file), result.file);
  } else if (!canonicalPatchSynced && (result.mutated || ["full", "create", "patch", "replace", "insert", "append", "noop"].includes(result.mode))) {
    await refreshWorkspaceUi({ preserveSelectionPath: joinWorkspacePath(result.file || "") || appState.selectedItem?.dataset.path || null });
    if (result.file && result.content != null) {
      const tabPath = normPath(joinWorkspacePath(result.file));
      const previousContent = openTabs.get(tabPath)?.savedContent
        ?? appState.contextFilesCache.find((file) => file.path === result.file)?.content
        ?? "";
      await applyEditToEditor({ ...tool, file: result.file }, result.content, previousContent);
    }
  }

  if (result.file && result.content != null && ["full", "create", "patch", "replace", "insert", "append", "noop"].includes(result.mode)) {
    appState.contextFilesCache = appState.contextFilesCache.filter((file) => file.path !== result.file);
    appState.contextFilesCache.push({ path: result.file, content: result.content });
  }

  syncActiveChatSession();
  restackFileRows(turn);
  scrollMessages();
}
