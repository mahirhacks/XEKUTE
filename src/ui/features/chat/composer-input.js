import { chatInput, selectedSlashCommandEl, sendBtn } from "../../core/dom-refs.js";
import {
  clearSelectedSlashCommand, reconcileSelectedSlashCommandAfterEdit, renderSlashSuggestions,
} from "./slash-commands.js";
import { appState } from "../../core/app-state.js";
import { appendFileTagText } from "./file-tags.js";
import { queueMigrationInFlight, schedulePersistChatSessions } from "./chat-persistence.js";
import { addErrorMessage, addUserMessage } from "./chat-messages.js";
import { liveInputController, stopGeneration } from "../../bootstrap.js";
import { chatSendInFlight, sendMessageWithAgentRuntime } from "./agent-run.js";
import { isRunningChatActive } from "./chat-run-state.js";
import { renderFileTagSuggestions } from "./file-tag-picker.js";

export const CHAT_INPUT_MAX_LINES = 12;

export function getChatInputMetrics() {
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

export function getChatInputMaxHeight() {
  const { line, padTop, padBot } = getChatInputMetrics();
  return Math.ceil(padTop + padBot + line * CHAT_INPUT_MAX_LINES);
}

export function getChatInputDefaultHeight() {
  const { line, padTop, padBot } = getChatInputMetrics();
  const declaredMinHeight = parseFloat(getComputedStyle(chatInput).minHeight) || 0;
  return Math.ceil(Math.max(padTop + padBot + line, declaredMinHeight));
}

// The editor's own scroll height is the rendered truth. Its text is not:
// Chromium keeps a placeholder <br> after a deleted last line, so innerText
// ends in "\n" while nothing renders below the text.
export function resizeChatInput() {
  if (!chatInput) return;
  const maxH = getChatInputMaxHeight();
  const minH = getChatInputDefaultHeight();
  chatInput.style.maxHeight = `${maxH}px`;
  chatInput.style.height = "0px";
  const scrollH = chatInput.scrollHeight;
  const next = Math.min(Math.max(scrollH, minH), maxH);
  chatInput.style.height = `${next}px`;
  const atCap = scrollH > maxH;
  chatInput.style.overflowY = atCap ? "auto" : "hidden";
  chatInput.classList.toggle("at-scroll-cap", atCap);
}

export function resetChatInput() {
  if (!chatInput) return;
  clearSelectedSlashCommand();
  chatInput.value = "";
  chatInput.style.overflowY = "hidden";
  chatInput.classList.remove("at-scroll-cap");
  chatInput.style.height = `${getChatInputDefaultHeight()}px`;
  resizeChatInput();
}

export function effectiveChatInputValue() {
  const text = String(chatInput?.value || "").trim();
  return appState.selectedSlashCommand ? `${appState.selectedSlashCommand}${text ? ` ${text}` : ""}` : String(chatInput?.value || "");
}

export function normalizeChatInputText(value = "") {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
}

export function fullChatInputEditorText() {
  if (!chatInput) return "";
  return normalizeChatInputText(chatInput.innerText || chatInput.textContent || "");
}

export function chatInputEditorValue() {
  const fullText = fullChatInputEditorText();
  if (!appState.selectedSlashCommand || !selectedSlashCommandEl || !chatInput?.contains(selectedSlashCommandEl)) {
    return fullText;
  }
  if (!fullText.startsWith(appState.selectedSlashCommand)) return fullText;
  return fullText.slice(appState.selectedSlashCommand.length).replace(/^ /, "");
}

export function syncChatInputEmptyState() {
  if (!chatInput) return;
  const editorValue = chatInputEditorValue();
  const isEmpty = !appState.selectedSlashCommand && !editorValue.replace(/[\r\n\u200b]/g, "");
  if (isEmpty && chatInput.childNodes.length) chatInput.replaceChildren();
  chatInput.classList.toggle("chat-input-empty", isEmpty);
}

export function renderChatInputEditorValue(value = "") {
  if (!chatInput) return;
  const text = normalizeChatInputText(value);
  chatInput.replaceChildren();
  if (appState.selectedSlashCommand && selectedSlashCommandEl) {
    selectedSlashCommandEl.hidden = false;
    chatInput.append(selectedSlashCommandEl);
    appendFileTagText(chatInput, ` ${text}`);
  } else {
    if (selectedSlashCommandEl) selectedSlashCommandEl.hidden = true;
    if (text) appendFileTagText(chatInput, text);
  }
  syncChatInputEmptyState();
}

export function syncChatInputEditableState(state) {
  if (!chatInput) return;
  const blocked = state.disabled || state.readOnly;
  chatInput.setAttribute("contenteditable", blocked ? "false" : "plaintext-only");
  chatInput.toggleAttribute("aria-readonly", state.readOnly);
  chatInput.toggleAttribute("aria-disabled", state.disabled);
}

export function installChatInputEditorAdapter() {
  if (!chatInput || chatInput.dataset.editorAdapter === "true") return;
  const state = {
    disabled: false,
    readOnly: false,
    placeholder: chatInput.dataset.placeholder || "",
  };
  Object.defineProperties(chatInput, {
    value: {
      configurable: true,
      get: () => chatInputEditorValue(),
      set: (value) => renderChatInputEditorValue(value),
    },
    disabled: {
      configurable: true,
      get: () => state.disabled,
      set: (value) => { state.disabled = Boolean(value); syncChatInputEditableState(state); },
    },
    readOnly: {
      configurable: true,
      get: () => state.readOnly,
      set: (value) => { state.readOnly = Boolean(value); syncChatInputEditableState(state); },
    },
    placeholder: {
      configurable: true,
      get: () => state.placeholder,
      set: (value) => {
        state.placeholder = String(value || "");
        chatInput.dataset.placeholder = state.placeholder;
        syncChatInputEmptyState();
      },
    },
  });
  chatInput.dataset.editorAdapter = "true";
  renderChatInputEditorValue("");
  syncChatInputEditableState(state);
}

export function setChatInputCaretToEnd() {
  if (!chatInput) return;
  const selection = window.getSelection?.();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(chatInput);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function isChatInputCaretAtArgumentStart() {
  if (!chatInput || !appState.selectedSlashCommand || !selectedSlashCommandEl || !chatInput.contains(selectedSlashCommandEl)) return false;
  const selection = window.getSelection?.();
  if (!selection || !selection.isCollapsed || !selection.anchorNode || !chatInput.contains(selection.anchorNode)) return false;
  const prefixRange = document.createRange();
  prefixRange.selectNodeContents(chatInput);
  try {
    prefixRange.setEnd(selection.anchorNode, selection.anchorOffset);
  } catch {
    return false;
  }
  const prefix = normalizeChatInputText(prefixRange.toString());
  return prefix === appState.selectedSlashCommand || prefix === `${appState.selectedSlashCommand} `;
}

export function isTextEditingTarget(element) {
  const selector = "input, textarea, select, [contenteditable]:not([contenteditable=\"false\"]), .monaco-editor, .xterm";
  return Boolean(element?.closest?.(selector) || document.activeElement?.closest?.(selector));
}

export async function migrateLegacyChatInputs(session) {
  if (!session?.promptQueue || queueMigrationInFlight.has(session.id)) return;
  queueMigrationInFlight.add(session.id);
  try {
    const result = await liveInputController.migrateQueue({ session, workspace: appState.rootPath });
    if (!result.ok) addErrorMessage("Saved prompts could not be sent. They are retained and will retry when this chat is opened.");
  } finally { queueMigrationInFlight.delete(session.id); schedulePersistChatSessions(); }
}

export async function submitLiveChatInput(session, text) {
  if (!session || !text.trim()) return;
  const record = liveInputController.prepare(session, text);
  if (appState.activeChatSessionId === session.id) addUserMessage(text, record.id);
  const receipt = await liveInputController.send({ session, workspace: appState.rootPath, text,
    sessionId: session.parentMemorySessionId || session.memorySessionId || session.id,
    targetTaskId: session.kind === "subagent" ? session.taskId : undefined, messageId: record.id,
    deferStart: chatSendInFlight.has(session.id) && !session.taskId });
  if (!receipt.ok) {
    addErrorMessage("Message was not saved. Your draft is retained. Press Send to retry.");
    return receipt;
  }
  if (!session.history.some((item) => item.id === record.id)) session.history.push({ role: "user", content: text, id: record.id, source_message_id: record.id, task_id: record.taskId, createdAt: new Date().toISOString() });
  if (appState.activeChatSessionId === session.id && effectiveChatInputValue() === text) { chatInput.value = ""; session.draftText = ""; resetChatInput(); }
  else if (session.draftText === text) session.draftText = "";
  schedulePersistChatSessions();
  updateSendBtn();
  return receipt;
}

export function submitChatComposer() {
  if (sendBtn.classList.contains("stop")) { stopGeneration(); return; }
  sendMessageWithAgentRuntime();
}
export function submitChatComposerFromInput() { submitChatComposer(); }

export function updateSendBtn() {
  const icon = sendBtn.querySelector(".codicon");
  const hasText = Boolean(effectiveChatInputValue().trim());
  // While a run is active with an empty composer, the control stops the agent.
  // With text to send (steering) or when idle, it sends. Images alone can
  // start a new message but never steer a running one.
  const running = isRunningChatActive();
  const stopMode = running && !hasText;
  const canSend = hasText || (!running && appState.composerImages.length > 0);
  sendBtn.classList.toggle("stop", stopMode);
  sendBtn.title = stopMode ? "Stop" : "Send message";
  sendBtn.setAttribute("aria-label", stopMode ? "Stop the agent" : "Send message");
  sendBtn.disabled = stopMode ? false : !canSend;
  if (icon) icon.className = `codicon ${stopMode ? "codicon-primitive-square" : "codicon-arrow-up"}`;
}

export function onChatInputChange() {
  reconcileSelectedSlashCommandAfterEdit();
  resizeChatInput();
  updateSendBtn();
  renderSlashSuggestions();
  renderFileTagSuggestions();
}
