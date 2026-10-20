import { ensureChatMemorySessionId } from "../history/chat-memory-session.js";
import { appState } from "../../core/app-state.js";
import { isInternalRuntimeInputMessage, isEmptyAssistantReply } from "./turn-structure.js";
import {
  chatSessions, closedChatSessions, archivedChatSessions, chatSessionsNeedingAttention,
  activeChatSession, syncActiveChatSession, renderChatSessionSelect, maybeNameActiveChat,
} from "./chat-sessions.js";
import { canonicalChatMode, modeLabel } from "./chat-mode.js";
import {
  estimateMessagesTokens, resolvedWorkingContextPlan, workingHistoryMessages,
  storeLastContextUsage, refreshStoredContextCapacity, updateContextUsage, renderMemorySaveBanner,
  applyContextReleaseUi,
} from "./context-usage.js";
import { getActiveFileContext, refreshDirMap, collectMentionedFiles } from "./prompt-context.js";
import {
  getExploreSubagentModel, getModelSettings, drainPendingBackgroundWaitEvents,
  completedAgentProcessIds, liveInputController, beginModelRunCommandWait,
} from "../../bootstrap.js";
import { scheduleSubagentResultDrain } from "../agents/parent-continuation.js";
import {
  summarizeSubagentActivity, createSubagentRunCard, setSubagentCardState,
  syncSubagentOrchestrationWaitStatus, handleSubagentCardEvent, ensureSubagentSessionTab,
  finalizeSubagentSessionTab,
} from "../agents/subagent-cards.js";
import { clearChatSessionStoppedByOperator } from "./run-stop.js";
import { chatInput } from "../../core/dom-refs.js";
import { MessageIdentity, TerminalManager } from "../../core/runtime-globals.js";
import {
  paintLiveInputRecord, applyCheckpointToSession, queueChatHistoryEvent, beginChatHistoryBlock,
  finishChatHistoryBlock, scheduleLiveChatSnapshot, schedulePersistChatSessions,
} from "./chat-persistence.js";
import {
  activeChatRuns, isChatSessionRunning, parentRunStillWorking, chatRunContainer,
  syncAssistantDraftToHistory, discardAssistantDraft, syncChatRunSession,
} from "./chat-run-state.js";
import { applyContextCheckpointUi, applyChatReferenceImportUi } from "./context-checkpoints.js";
import {
  setAgentStatus, scrollMessages, isSilentToolRoutingActivity, mergeAppendedChatMessages,
  addUserMessage, addErrorMessage,
} from "./chat-messages.js";
import { isEndTurnTool, applyEndTurnStopToUi, toolUiResult } from "./tool-labels.js";
import { ensureToolCard, applyToolResultToUi } from "./tool-cards.js";
import { isAgentTerminalTool } from "./command-timeline.js";
import {
  isTaskListTool, clearComposerTaskList, renderComposerTaskList,
} from "./composer-questions.js";
import { createAssistantTurn } from "./assistant-turn.js";
import {
  closeSlashSuggestions, expandSlashCommand, runSpecialSlashCommand,
} from "./slash-commands.js";
import {
  resizeChatInput, resetChatInput, effectiveChatInputValue, submitLiveChatInput, updateSendBtn,
} from "./composer-input.js";
import { takeComposerImages } from "./composer-images.js";

export const chatSendInFlight = new Set();
export const hiddenAgentRuntimeQueues = new Map();

export async function executeHiddenAgentRuntime({ targetSessionId = "", text = "", options = {} } = {}) {
  const runSession = [...chatSessions, ...closedChatSessions, ...archivedChatSessions]
    .find((session) => session.id === String(targetSessionId || ""));
  if (!runSession) return { ok: false, code: "BACKGROUND_SESSION_NOT_FOUND" };
  const runModel = runSession.selectedModel || appState.selectedModel;
  if (!runModel) return { ok: false, code: "BACKGROUND_MODEL_NOT_SELECTED" };
  const runMode = options?.modeOverride
    ? canonicalChatMode(options.modeOverride)
    : canonicalChatMode(runSession.turnMode || runSession.chatMode || appState.chatMode);
  const runFamily = runSession.chatFamily || appState.chatFamily;
  const runSettings = getModelSettings(runModel);
  const runContextPlan = resolvedWorkingContextPlan(runModel);
  ensureChatMemorySessionId(runSession);
  const runtimeSessionId = runSession.memorySessionId || runSession.id;
  const providedContextFiles = Array.isArray(options?.contextFiles)
    ? options.contextFiles.filter((file) => file && typeof file.path === "string" && typeof file.content === "string")
    : [];
  const runActiveFile = Object.prototype.hasOwnProperty.call(options || {}, "activeFile")
    ? options.activeFile
    : (providedContextFiles[0] || getActiveFileContext());
  const runWorkspace = String(options?.workspace || appState.rootPath || "");
  try {
    // Background lanes never open cards or transcript rows. Their global
    // event sink auto-skips any clarification request that cannot be shown.
    const result = await window.api.agentRun({
      workspace: runWorkspace,
      model: runModel,
      numCtx: runContextPlan.provider === "ollama" ? runContextPlan.effectiveLimitTokens : null,
      contextBudget: runContextPlan.effectiveLimitTokens,
      contextPlan: runContextPlan,
      thinking: runSettings.thinking,
      reasoningEffort: runContextPlan.provider === "openrouter" ? runSettings.reasoningEffort : null,
      mode: runMode,
      modeFamily: runFamily,
      authorityProfile: appState.authoritySettingsData.superMode,
      chatHistory: workingHistoryMessages((runSession.history || []).filter((message) => !isInternalRuntimeInputMessage(message)), runSession),
      rawSourceTokens: estimateMessagesTokens((runSession.history || []).filter((message) => !isInternalRuntimeInputMessage(message))),
      sessionId: runtimeSessionId,
      chatSessionId: runSession.id,
      blockId: runSession.memoryBlockId || "",
      dirMap: appState.dirMapCache,
      activeFile: runActiveFile,
      extraFiles: providedContextFiles,
      subagentModel: getExploreSubagentModel(),
      userMessage: options?.continuation ? "" : String(text || ""),
      internalRuntimeInput: true,
      internalSkillId: String(options?.internalSkillId || ""),
      continuation: options?.continuation || null,
      backgroundRuntime: true,
    });
    return result;
  } catch (error) {
    return { ok: false, error: error?.message || "Background runtime failed.", code: error?.code || "BACKGROUND_RUNTIME_FAILED" };
  } finally {
    queueMicrotask(drainPendingBackgroundWaitEvents);
    scheduleSubagentResultDrain();
  }
}

export function sendHiddenAgentRuntime(payload = {}) {
  const key = String(payload.targetSessionId || "");
  const prior = hiddenAgentRuntimeQueues.get(key) || Promise.resolve();
  const task = prior
    .catch(() => {})
    .then(() => executeHiddenAgentRuntime(payload));
  hiddenAgentRuntimeQueues.set(key, task);
  task.finally(() => {
    if (hiddenAgentRuntimeQueues.get(key) === task) hiddenAgentRuntimeQueues.delete(key);
  });
  return task;
}

export async function sendMessageWithAgentRuntime(options = {}) {
  const internal = Boolean(options?.internal);
  const targetSessionId = String(options?.sessionId || appState.activeChatSessionId || "");
  const hasExplicitText = Object.prototype.hasOwnProperty.call(options || {}, "text");
  let text = hasExplicitText
    ? String(options.text || "")
    : effectiveChatInputValue();
  if (internal && !hasExplicitText) {
    text = "Review the delegated result and decide the next action.";
  }
  if (!internal) {
    // Images go with a new message only; a run already in progress gets text.
    const busy = isChatSessionRunning(targetSessionId) || chatSendInFlight.has(targetSessionId);
    const sendingImages = !busy && appState.composerImages.length > 0;
    if (!text.trim() && !sendingImages) return;
    if (busy) {
      return submitLiveChatInput(chatSessions.find((session) => session.id === targetSessionId), text);
    }
    if (!text.trim()) text = appState.composerImages.length > 1 ? "See the attached images." : "See the attached image.";
    chatSendInFlight.add(targetSessionId);
    clearChatSessionStoppedByOperator(chatSessions.find((session) => session.id === targetSessionId) || { id: targetSessionId });
  } else if (!text || isChatSessionRunning(targetSessionId)) return;
  try {

  if (!internal && text.startsWith("/")) {
    const handled = await runSpecialSlashCommand(text);
    if (handled) { chatInput.value = ""; resetChatInput(); closeSlashSuggestions(); return; }
  }
  if (!internal) text = expandSlashCommand(text);
  if (!text) {
    resetChatInput();
    closeSlashSuggestions();
    return;
  }
  closeSlashSuggestions();

  if (internal) {
    return sendHiddenAgentRuntime({ targetSessionId, text, options });
  }

  const runSession = chatSessions.find((session) => session.id === targetSessionId)
    || (internal ? null : activeChatSession());
  if (!runSession) return;
  let runHistory = runSession.history;
  const runModel = runSession.selectedModel || appState.selectedModel;
  const runMode = options?.modeOverride
    ? canonicalChatMode(options.modeOverride)
    : canonicalChatMode(runSession.chatMode || appState.chatMode);
  runSession.turnMode = runMode;
  const runFamily = runSession.chatFamily || appState.chatFamily;
  if (!runModel) {
    if (!internal) addErrorMessage("Select a model before sending a message.");
    return;
  }
  ensureChatMemorySessionId(runSession);
  const runSettings = getModelSettings(runModel);
  const runContextPlan = resolvedWorkingContextPlan(runModel);
  const providedContextFiles = Array.isArray(options?.contextFiles)
    ? options.contextFiles.filter((file) => file && typeof file.path === "string" && typeof file.content === "string")
    : [];
  const hasActiveFileOverride = Object.prototype.hasOwnProperty.call(options || {}, "activeFile");
  const runActiveFile = hasActiveFileOverride
    ? options.activeFile
    : (providedContextFiles[0] || getActiveFileContext());

  const initialInput = !internal ? liveInputController.prepare(runSession, text) : null;
  const runImages = internal ? [] : takeComposerImages();
  if (!internal) {
    {
      chatInput.value = "";
      runSession.draftText = "";
      runSession.draftSlashCommand = "";
      resetChatInput();
    }
    if (appState.activeChatSessionId === runSession.id) addUserMessage(text, initialInput.id, runImages.map((image) => ({ thumb: image.thumbUrl, id: image.storedId })));
  }
  const userMessage = {
    role: "user",
    content: text,
    id: initialInput?.id || `${runSession.id}-message-${Date.now()}-${runHistory.length + 1}`,
    ...(initialInput ? { source_message_id: initialInput.id } : {}),
    createdAt: new Date().toISOString(),
    ...(internal ? { __xekuteInternalRuntimeInput: true } : {}),
  };
  const lastHistoryMessage = runHistory.at(-1);
  const reusedUserMessage = lastHistoryMessage?.id === userMessage.id
    ? lastHistoryMessage
    : null;
  if (!reusedUserMessage) runHistory.push(userMessage);
  const promptMessage = reusedUserMessage || userMessage;
  if (!internal) maybeNameActiveChat(text);
  if (!internal) runSession.taskId = "";
  const run = {
    sessionId: runSession.id,
    userImages: runImages,
    initialInputId: initialInput?.id || "",
    session: runSession,
    history: runHistory,
    model: runModel,
    mode: runMode,
    family: runFamily,
    workspace: appState.rootPath,
    contextPlan: runContextPlan,
    contextFilesCache: [],
    activeStreamContent: "",
    viewHost: null,
    state: "running",
    stopRequested: false,
    modelTurnOpen: true,
    assistantDraftFinalized: false,
    contextCheckpointPending: false,
    internal,
    continuation: options?.continuation || null,
  };
  activeChatRuns.set(run.sessionId, run);
  setAgentStatus(`${modeLabel(runMode)} working`);
  updateSendBtn();
  renderChatSessionSelect();

  await beginChatHistoryBlock(text, runSession);
  run.memorySessionId = runSession.memorySessionId || run.sessionId;
  const checkpointPromptIndex = runHistory.findIndex((message) => message?.id === promptMessage.id);
  if (checkpointPromptIndex >= 0) runSession.memoryBlockHistoryStart = checkpointPromptIndex;
  syncChatRunSession(run);
  runHistory = run.history;

  let assistant = null;
  let agentRunResult = null;
  let unsubscribeAgentEvent = () => {};
  let chatHistoryFinalized = false;
  const finalizeChatHistory = async (outcome) => {
    if (chatHistoryFinalized) return;
    chatHistoryFinalized = true;
    syncAssistantDraftToHistory(run, assistant, { persist: false });
    syncChatRunSession(run, { persist: false });
    await finishChatHistoryBlock({ session: runSession, assistant, outcome });
  };
  const runIsVisible = () => appState.activeChatSessionId === runSession.id && !run.viewHost;
  const updateRunContextUsage = () => { if (runIsVisible()) updateContextUsage(); };
  const scrollRunMessages = (options) => { if (runIsVisible()) scrollMessages(options); };
  const setRunAgentStatus = (value) => { if (runIsVisible()) setAgentStatus(value); };

  try {
    await refreshDirMap();
    run.contextFilesCache = options?.skipContextFiles
      ? []
      : providedContextFiles.length
        ? providedContextFiles
        : await collectMentionedFiles(text);
    if (runIsVisible()) appState.contextFilesCache = run.contextFilesCache;
    syncChatRunSession(run);
    runHistory = run.history;
    updateRunContextUsage();

    assistant = createAssistantTurn({ container: chatRunContainer(run), sessionId: run.sessionId });
    run.assistant = assistant;
    assistant.contentEl.classList.add("streaming");
    assistant.setLiveState({ kind: "working", detail: "Starting" });

    let contentStarted = false;
    let lastAgentText = "";

    const handleAgentEvent = async (payload) => {
    if (!payload) return;
    // Main-owned FIFO continuations have their own renderer event bridge. The
    // original user-turn listener may still be settling its IPC response when
    // the main process starts the continuation, so do not render those events
    // into the old assistant turn as well.
    if (payload.source === "parent_continuation") return;

    if (payload.type === "model_run_command_wait") {
      beginModelRunCommandWait(run, assistant, payload);
      return;
    }

    if (payload.type === "chat_reference_import") {
      applyChatReferenceImportUi(run, payload);
      return;
    }
    if (payload.type === "memory_save_health") {
      if (runSession) {
        runSession.memorySaveHealth = payload.ok === false ? { reason: String(payload.reason || "write_failed") } : null;
        // Closing hides one failure; after a recovery the next one shows again.
        if (payload.ok !== false) runSession.memorySaveDismissed = null;
      }
      renderMemorySaveBanner();
      return;
    }
    if (payload.type === "context_release") {
      applyContextReleaseUi(run, payload);
      return;
    }
    if (payload.type === "context_checkpoint") {
      // Checkpointing is automatic and main-process owned. The in-chat
      // placeholder stays after completion so the operator can see that
      // summarized conversation was refreshed.
      applyCheckpointToSession(runSession, payload);
      applyContextCheckpointUi(run, payload);
      return;
    }

    if (payload.type === "task_list") {
      run.taskList = payload.clear || payload.completed ? null : payload;
      if (runIsVisible()) renderComposerTaskList(payload);
      return;
    }

    if (payload.type === "task_brief" && payload.brief) {
      assistant.ensureTaskBrief(payload.brief);
      setRunAgentStatus("Plan ready · starting");
      return;
    }

    if (payload.type === "subagent_queued" || payload.type === "subagent_started") {
      const card = createSubagentRunCard(assistant, payload);
      if (card) {
        card.dataset.model = String(payload.model || "");
        card.dataset.summary = summarizeSubagentActivity(payload);
        setSubagentCardState(card, payload.type === "subagent_queued" ? "queued" : "working");
      }
      // Register the child chat session tab so the operator can click into it.
      ensureSubagentSessionTab(payload);
      scrollRunMessages();
      return;
    }

    if (payload.type === "subagent_activity" || payload.type === "subagent_completed" || payload.type === "subagent_stopped" || payload.type === "subagent_failed") {
      handleSubagentCardEvent(assistant, payload);
      if (payload.type === "subagent_completed" || payload.type === "subagent_stopped" || payload.type === "subagent_failed") {
        finalizeSubagentSessionTab(payload);
      }
      return;
    }

    if (payload.type === "status") {
      assistant.setStatus(payload.text || "Working...");
      setRunAgentStatus(payload.text || `${modeLabel(runMode)} working`);
      return;
    }

    if (payload.type === "activity") {
      if (isSilentToolRoutingActivity(payload.text)) return;
      const kind = payload.kind || "info";
      if (payload.text && kind !== "meta" && kind !== "success") assistant.setStatus(payload.text);
      assistant.noteTaskActivity(payload.text, kind);
      if (kind === "warn" || kind === "error") setRunAgentStatus(payload.text || `${modeLabel(runMode)} warning`);
      return;
    }

    if (payload.type === "thinking") {
      assistant.setLiveState({ kind: "thinking", detail: "Thinking" });
      assistant.appendThinking(payload.token || payload.delta || "");
      return;
    }

    if (payload.type === "model_round") {
      assistant.applyModelRound(payload);
      return;
    }

    if (payload.type === "content" || payload.type === "token") {
      const delta = String(payload.delta || payload.token || "");
      if (!delta) return;
      // Reasoning and answer deltas are interleaved. Sealing here opens a new
      // "Thought for…" fold on the next reasoning token. The passage ends at
      // model_round or when a tool actually starts.
      if (!contentStarted) {
        contentStarted = true;
        assistant.clearStatus();
      }
      assistant.appendContent(delta);
      run.activeStreamContent = assistant.rawContent;
      syncAssistantDraftToHistory(run, assistant, { persist: false });
      if (runIsVisible()) appState.activeStreamContent = run.activeStreamContent;
      lastAgentText = assistant.rawContent;
      return;
    }

    if (payload.type === "output_continuation") {
      assistant.setStatus("Continuing the response…");
      scrollRunMessages();
      return;
    }

    if (payload.type === "context_usage" && payload.usage) {
      storeLastContextUsage(payload.usage, { session: runSession, model: runModel, contextPlan: runContextPlan });
      updateRunContextUsage();
      return;
    }

    if (payload.type === "run_state") {
      const state = payload.state || {};
      const phase = String(state.phase || "preflight").replace(/-/g, " ");
      assistant.updateTaskStage(phase);
      assistant.setStatus(`${phase} · ${state.completionGate || "working"}`);
      setRunAgentStatus(`${modeLabel(runMode)} · ${phase}`);
      return;
    }



    if (payload.type === "questions_required") {
      await queueChatHistoryEvent({
        type: "questions_presented",
        requestId: payload.requestId,
        reason: payload.reason,
        questions: payload.questions || [],
      }, { session: runSession });
      const response = await assistant.requestQuestions(payload);
      await queueChatHistoryEvent({
        type: "questions_answered",
        requestId: payload.requestId,
        answers: response?.answers || [],
        skipped: Boolean(response?.skipped),
        expired: Boolean(response?.expired),
      }, { session: runSession });
      await window.api.agentResolveQuestions({
        requestId: payload.requestId,
        answers: response?.answers || [],
        skipped: Boolean(response?.skipped),
      });
      assistant.setStatus(response?.skipped ? "Clarification skipped" : "Clarification answers submitted");
      return;
    }

    if (payload.type === "tool_call") {
      const tools = Array.isArray(payload.tools) ? payload.tools : [];
      if (!tools.length) return;
      const workTools = tools.filter((tool) => !isEndTurnTool(tool) && !isTaskListTool(tool));
      assistant.beginModelBlock();
      if (workTools.length) assistant.noteModelOutput();
      for (const tool of workTools) {
        if (!isAgentTerminalTool(tool)) ensureToolCard(assistant.turn, assistant.contentEl, tool, { pending: true });
      }
      if (workTools.length === 1) {
        assistant.setStatus(ToolParser.toolStatusLabel(workTools[0]));
      } else if (workTools.length > 1) {
        assistant.setStatus(`Using ${workTools.length} tools...`);
      }
      scrollRunMessages();
      return;
    }

    if (payload.type === "agent_terminal") {
      if (payload.phase === "start" || payload.phase === "queued" || payload.phase === "started") {
        TerminalManager.attachAgentSession({
          id: payload.id || payload.terminalId,
          command: payload.command || "command",
          toolName: payload.toolName || "exec_command",
          cwd: payload.cwd || "",
          shell: payload.shell || "auto",
          queued: payload.phase === "queued",
        });
        globalThis.expandTerminalPanel?.({ createIfMissing: false });
      }
      return;
    }

    if (payload.type === "tool_start" && payload.tool) {
      if (isEndTurnTool(payload.tool)) {
        assistant.finalizeThinking();
        return;
      }
      const toolHistoryWrite = queueChatHistoryEvent({
        type: "tool_usage",
        toolName: payload.tool.toolName || payload.tool.action || payload.tool.name || "tool",
      }, { session: runSession });
      assistant.markToolUse();
      assistant.finalizeThinking();
      if (isTaskListTool(payload.tool)) {
        assistant.setStatus("Organizing the task list…");
        toolHistoryWrite.catch(() => {});
        return;
      }
      if (isAgentTerminalTool(payload.tool)) {
        const operation = String(payload.tool.args?.operation || "run");
        if (operation === "run" || operation === "start") assistant.ensureCommandEvent(payload.tool);
        assistant.setStatus("Running command…");
      } else {
        ensureToolCard(assistant.turn, assistant.contentEl, payload.tool, { pending: true });
        assistant.setStatus(ToolParser.toolStatusLabel(payload.tool));
      }
      scrollRunMessages();
      toolHistoryWrite.catch(() => {});
      return;
    }

    if (payload.type === "tool_result" && payload.tool && payload.result) {
      if (isEndTurnTool(payload.tool)) {
        applyEndTurnStopToUi(assistant, payload.result);
        return;
      }
      if (isTaskListTool(payload.tool)) {
        assistant.setStatus(payload.result?.error ? "Task list update failed" : "Task list updated");
        return;
      }
      const uiResult = toolUiResult(payload.result);
      const summary = uiResult.error
        ? `Failed: ${uiResult.error}`
        : uiResult.summary || uiResult.command || uiResult.mode || "Complete";
      assistant.noteTaskActivity(uiResult.error ? `Blocked or failed · ${summary}` : `Completed · ${summary}`, uiResult.error ? "warn" : "success");
      assistant.setLiveState({
        kind: uiResult.error ? "error" : "success",
        detail: uiResult.error ? "Action failed" : "Action complete",
      });
      if (isAgentTerminalTool(payload.tool)) {
        assistant.completeCommandEvent(payload.tool, uiResult);
      } else {
        await applyToolResultToUi(payload.tool, uiResult, assistant.turn, assistant.contentEl);
      }
      updateRunContextUsage();
    }
    };

    // Serialize agent events. Concurrent handling races tool_start/sealing
    // against late content tokens and leaves unfinished sentence fragments
    // above each "Ran Command" card.
    let agentEventQueue = Promise.resolve();
    unsubscribeAgentEvent = window.api.onAgentEvent((payload) => {
      const eventSessionId = String(payload?.sessionId || "");
      const runEventSessionId = String(run.memorySessionId || runSession.memorySessionId || runSession.id);
      if (!eventSessionId || eventSessionId !== runEventSessionId) return;
      agentEventQueue = agentEventQueue
        .then(async () => {
          await handleAgentEvent(payload);
          scheduleLiveChatSnapshot(run);
        })
        .catch(() => {});
    });

    agentRunResult = await window.api.agentRun({
      workspace: appState.rootPath,
      model: runModel,
      numCtx: runContextPlan.provider === "ollama" ? runContextPlan.effectiveLimitTokens : null,
      contextBudget: runContextPlan.effectiveLimitTokens,
      contextPlan: runContextPlan,
      thinking: runSettings.thinking,
      reasoningEffort: runContextPlan.provider === "openrouter" ? runSettings.reasoningEffort : null,
      mode: runMode,
      modeFamily: runFamily,
      authorityProfile: appState.authoritySettingsData.superMode,
       chatHistory: workingHistoryMessages(runHistory.filter((message) => !isInternalRuntimeInputMessage(message)), runSession),
      rawSourceTokens: estimateMessagesTokens(runHistory.filter((message) => !isInternalRuntimeInputMessage(message))),
       sessionId: runSession?.memorySessionId || runSession?.id || "",
       chatSessionId: runSession?.id || "",
       blockId: runSession?.memoryBlockId || "",
      dirMap: appState.dirMapCache,
      activeFile: runActiveFile,
      extraFiles: run.contextFilesCache,
      subagentModel: getExploreSubagentModel(),
       userMessage: internal && options?.continuation ? "" : text,
       userImages: (run.userImages || []).map(({ name, mediaType, dataUrl }) => ({ name, mediaType, dataUrl })),
       userMessageId: promptMessage.id,
       internalRuntimeInput: internal,
       internalSkillId: internal ? String(options?.internalSkillId || "") : "",
       continuation: internal ? (options?.continuation || null) : null,
    });
    if (run.stopRequested) {
      run.orchestrationHold = false;
      run.pendingEndTurn = false;
    } else if (agentRunResult && typeof agentRunResult === "object") {
      run.orchestrationHold = Boolean(agentRunResult.orchestrationHold);
      run.pendingEndTurn = Boolean(agentRunResult.pendingEndTurn);
      run.commandWait = Boolean(agentRunResult.commandWait);
      if (run.commandWait && Array.isArray(agentRunResult.waitingProcessIds)) {
        run.commandWaitIds = new Set(agentRunResult.waitingProcessIds.map((id) => String(id)).filter((id) => !completedAgentProcessIds.has(id)));
      }
    }
    const result = agentRunResult;
    // Drain serialized UI events so the last tokens/tool cards land before
    // we finalize the transcript.
    await agentEventQueue;
    if (result?.contextUsage) {
      storeLastContextUsage(result.contextUsage, { session: runSession, model: runModel, contextPlan: runContextPlan });
    }

    assistant.contentEl.classList.remove("streaming");
    assistant.finalizeThinking();

    // A stop during summarization ends the run without a completed checkpoint
    // event; the pending notice must not keep saying it is summarizing.
    if ((result?.aborted || run.stopRequested) && run.contextCheckpointPending) applyContextCheckpointUi(run, { status: "interrupted" });

    if (result?.error) {
      const aborted = Boolean(result.aborted || run.stopRequested);
      assistant.completeTaskBrief(aborted ? "stopped" : "error");
      assistant.finishLiveState(aborted ? "stopped" : "error");
      // Internal continuation failures are returned to the FIFO drain. Do
      // not surface a transient hand-off race (or a coordinator stop) as a
      // user-facing error, but keep the complete result object available so
      // the drain can requeue PARENT_BUSY and release stopped results.
      const transientContinuation = internal && (result.aborted || ["PARENT_BUSY", "SUBAGENT_RESULT_NOT_READY"].includes(String(result.code || "")));
      if (!transientContinuation && !aborted) addErrorMessage(result.error, { container: chatRunContainer(run), session: runSession });
      await finalizeChatHistory(run.stopRequested || aborted ? "stopped" : "failed");
      syncChatRunSession(run);
      return agentRunResult;
    }

    if (run.stopRequested) {
      assistant.setRawContent(assistant.rawContent.trim() || lastAgentText.trim());
      assistant.finalOutcome = "stopped";
      assistant.completeTaskBrief("stopped");
      assistant.finalizeContent();
      updateRunContextUsage();
      await finalizeChatHistory("stopped");
      return agentRunResult;
    }

    if (Array.isArray(result?.appendedMessages) && result.appendedMessages.length) {
      if (result.appendedMessages.some((message) => message?.role === "assistant" && String(message.content || "").trim())) {
        discardAssistantDraft(run, assistant);
      }
      const appended = MessageIdentity?.ensureMessageIdentity
        ? MessageIdentity.ensureMessageIdentity(result.appendedMessages, `${runSession.id}-agent`)
        : result.appendedMessages;
      const appendedWithTime = (Array.isArray(appended) ? appended : []).map((message) => ({
        ...message,
        createdAt: message.createdAt || new Date().toISOString(),
      }));
      mergeAppendedChatMessages(runHistory, appendedWithTime);
    }

    const finalText = String(result?.finalText || "").trim();
    const hasStopVerdict = [...(assistant.workHostTurn?.()?.children || [])].some((child) => (
      child.classList.contains("assistant-reply")
      && child.dataset.workVerdict === "true"
      && !isEmptyAssistantReply(child)
    ));
    if (finalText && !assistant.rawContent.trim() && !hasStopVerdict) assistant.setRawContent(finalText);
    else if (!assistant.displayContent().trim() && !hasStopVerdict && lastAgentText.trim()) {
      assistant.setRawContent(lastAgentText);
    }

    if ((run.orchestrationHold || run.pendingEndTurn || run.commandWait) && !run.stopRequested) {
      for (const turn of assistant.assistantTurns?.() || [assistant.turn]) {
        turn?.setAttribute("aria-busy", "true");
      }
      assistant.turn?.closest(".chat-exchange")?.querySelectorAll(".assistant-reply-footer").forEach((node) => node.remove());
      syncChatRunSession(run);
      syncSubagentOrchestrationWaitStatus(run);
    } else {
      assistant.completeTaskBrief(result?.runState?.status === "inconclusive" ? "inconclusive" : "complete");
      assistant.finalizeContent();
      // A run that stopped on a limit (such as the context window) before
      // writing anything would otherwise leave the prompt with no answer at all.
      const limitations = Array.isArray(result?.runState?.limitations) ? result.runState.limitations : [];
      if (result?.code && !assistant.displayContent().trim() && !hasStopVerdict) {
        addErrorMessage(String(limitations.at(-1) || "The agent stopped before answering. You can retry the message."), { container: chatRunContainer(run), session: runSession });
      }
      assistant.pruneIfEmpty();
      syncChatRunSession(run);
      await finalizeChatHistory(assistant.rawContent.trim() ? "completed" : "incomplete");
    }
  } catch (error) {
    agentRunResult = {
      ok: false,
      error: error?.message || "The agent run failed unexpectedly.",
      code: error?.code || "AGENT_RUN_FAILED",
      aborted: Boolean(run.stopRequested),
    };
    assistant?.completeTaskBrief?.(run.stopRequested ? "stopped" : "error");
    assistant?.finishLiveState?.(run.stopRequested ? "stopped" : "error");
    await finalizeChatHistory(run.stopRequested ? "stopped" : "failed");
    if (!run.stopRequested) {
      addErrorMessage(error?.message || "The agent run failed unexpectedly. You can retry the message.", {
        container: chatRunContainer(run),
        session: runSession,
      });
    }
    syncChatRunSession(run);
  } finally {
    if (run.stopRequested) {
      run.orchestrationHold = false;
      run.pendingEndTurn = false;
      run.awaitingParentContinuation = false;
    }
    run.modelTurnOpen = false;
    const holdActive = Boolean(run?.orchestrationHold) && !run.stopRequested;
    const stillWorking = parentRunStillWorking(run);
    if (!stillWorking) unsubscribeAgentEvent();
    if (assistant?.turn && assistant.turn.getAttribute("aria-busy") === "true" && !stillWorking) {
      assistant.finishLiveState(run.stopRequested ? "stopped" : assistant.finalOutcome || "complete");
    }
    run.activeStreamContent = "";
    if (!stillWorking) assistant?.pruneIfEmpty();
    syncChatRunSession(run);
    const completedInBackground = appState.activeChatSessionId !== runSession.id;
    if (stillWorking) {
      run.state = "running";
      run.visibleSettled = false;
      activeChatRuns.set(runSession.id, run);
      syncSubagentOrchestrationWaitStatus(run);
    } else {
      syncSubagentOrchestrationWaitStatus(run);
      run.state = "complete";
      run.visibleSettled = true;
      if (activeChatRuns.get(runSession.id) === run) activeChatRuns.delete(runSession.id);
    }
    if (!stillWorking && run.taskList?.source === "agent" && appState.activeChatSessionId === runSession.id) clearComposerTaskList();
    if (completedInBackground) chatSessionsNeedingAttention.add(runSession.id);
    else chatSessionsNeedingAttention.delete(runSession.id);
    if (appState.activeChatSessionId === runSession.id && !stillWorking) appState.activeStreamContent = "";
    if (appState.activeChatSessionId === runSession.id) setAgentStatus(stillWorking ? `${modeLabel()} orchestrating…` : `${modeLabel()} ready`);
    updateSendBtn();
    renderChatSessionSelect();
    if (appState.activeChatSessionId === runSession.id) {
      updateContextUsage();
      refreshStoredContextCapacity();
    }

    if (appState.activeChatSessionId === runSession.id) syncActiveChatSession();
    if (appState.activeChatSessionId === runSession.id && !appState.contextCheckpointing && !stillWorking) {
      chatInput.disabled = false;
      chatInput.readOnly = false;
      chatInput.removeAttribute("aria-disabled");
    }
    queueMicrotask(drainPendingBackgroundWaitEvents);
    scheduleSubagentResultDrain();
  }
  return agentRunResult;
  } finally {
    if (!internal) {
      const session = chatSessions.find((item) => item.id === targetSessionId);
      const initial = session?.liveInputs?.find((item) => item.text === text && item.status === "sending");
      if (initial?.status === "sending") {
        initial.status = "failed";
        paintLiveInputRecord(session, initial);
        if (!session.draftText) session.draftText = initial.text;
        if (appState.activeChatSessionId === session.id && !effectiveChatInputValue().trim()) { chatInput.value = initial.text; resizeChatInput(); }
        schedulePersistChatSessions();
      }
      chatSendInFlight.delete(targetSessionId);
    }

  }
}
