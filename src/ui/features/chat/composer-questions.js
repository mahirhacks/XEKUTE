import { toolActionName } from "./tool-labels.js";
import { appState } from "../../core/app-state.js";
import { inputBar, composerTaskListEl, composerQuestionsEl } from "../../core/dom-refs.js";
import { escapeHtml } from "../../core/text-format.js";
import { QUESTION_ICON_SRC } from "./question-answers.js";
import { chatSessionIdForRuntimeId } from "../agents/delegated-child-runs.js";
import { chatStopIdsForRun } from "./run-stop.js";

export const pendingComposerQuestionsBySession = new Map();
export const pendingOrchestratorEscalatedQuestions = new Map();

export function isTaskListTool(tool) {
  return ["update_task_list", "manage_task_checklist"].includes(toolActionName(tool));
}

export function clearComposerTaskList() {
  appState.activeComposerTaskList = null;
  if (composerTaskListEl) {
    composerTaskListEl.hidden = true;
    composerTaskListEl.innerHTML = "";
  }
  inputBar?.classList.remove("has-composer-task-list");
}

export function renderComposerTaskList(payload = {}) {
  if (!composerTaskListEl) return;
  const tasks = (Array.isArray(payload.tasks) ? payload.tasks : [])
    .filter((task) => task && String(task.title || "").trim())
    .slice(0, 20)
    .map((task, index) => ({
      id: String(task.id || `task-${index + 1}`),
      title: String(task.title || "").replace(/\s+/g, " ").trim(),
      status: ["pending", "in_progress", "completed", "blocked"].includes(String(task.status || "")) ? String(task.status) : "pending",
    }));
  if (payload.clear || !tasks.length) {
    clearComposerTaskList();
    return;
  }

  const currentIndex = Math.max(0, tasks.findIndex((task) => ["in_progress", "blocked", "pending"].includes(task.status)));
  const expanded = Boolean(appState.activeComposerTaskList?.expanded);
  appState.activeComposerTaskList = { ...payload, tasks, currentIndex, expanded };
  composerTaskListEl.hidden = false;
  inputBar?.classList.add("has-composer-task-list");

  const rows = tasks.map((task, index) => `
    <div class="composer-task-list-row" data-task-status="${escapeHtml(task.status)}" data-task-index="${index}"${!expanded && index !== currentIndex ? " hidden" : ""}>
      <span class="composer-task-list-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" focusable="false">
          <rect x="2" y="2" width="20" height="20" rx="4" stroke="currentColor" stroke-width="2.5"/>
          ${task.status === "completed" ? '<rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor"/>' : ""}
          ${task.status === "in_progress" ? `<g fill="currentColor" class="composer-task-list-progress">
            <rect x="6" y="6" width="12" height="2.5"/>
            <rect x="6" y="11" width="12" height="2.5"/>
            <rect x="6" y="16" width="12" height="2.5"/>
          </g>` : ""}
        </svg>
      </span>
      <span class="composer-task-list-count">${index + 1}/${tasks.length}</span>
      <span class="composer-task-list-title">${escapeHtml(task.title)}</span>
    </div>
  `).join("");
  composerTaskListEl.innerHTML = `<button type="button" class="composer-task-list-card" aria-expanded="${String(expanded)}" aria-label="${expanded ? "Collapse" : "Expand"} task list">${rows}</button>`;
  const card = composerTaskListEl.querySelector(".composer-task-list-card");
  card?.addEventListener("click", () => {
    if (!appState.activeComposerTaskList) return;
    appState.activeComposerTaskList.expanded = !appState.activeComposerTaskList.expanded;
    renderComposerTaskList(appState.activeComposerTaskList);
  });
}

export function composerQuestionSessionId(sessionId = appState.activeChatSessionId) {
  return String(sessionId || appState.activeChatSessionId || "");
}

export const COMPOSER_FREE_WRITE_ID = "free_write";

export function questionOptionsWithFreeWrite(question = {}) {
  const options = Array.isArray(question.options) ? [...question.options] : [];
  if (options.some((option) => option?.freeWrite || option?.id === COMPOSER_FREE_WRITE_ID)) return options;
  options.push({
    id: COMPOSER_FREE_WRITE_ID,
    label: "Or describe something else",
    recommended: false,
    freeWrite: true,
  });
  return options;
}

export function syncComposerQuestionsForActiveSession() {
  if (!composerQuestionsEl) return;
  const pending = pendingComposerQuestionsBySession.get(String(appState.activeChatSessionId || "")) || null;
  composerQuestionsEl.replaceChildren();
  if (pending?.block) composerQuestionsEl.appendChild(pending.block);
  composerQuestionsEl.hidden = !pending;
  inputBar?.classList.toggle("has-composer-questions", Boolean(pending));
}

export function showCommandApprovalPanel({
  command = "",
  title = "Allow the below command to be executed?",
  requestId = "",
  sessionId = appState.activeChatSessionId,
  onLiveState = null,
} = {}) {
  const ownerSessionId = composerQuestionSessionId(sessionId);
  const existing = pendingComposerQuestionsBySession.get(ownerSessionId);
  if (existing) return existing.promise;
  if (!composerQuestionsEl) {
    return Promise.resolve({ answers: [], skipped: false, requestId });
  }

  const block = document.createElement("section");
  block.className = "agent-questions-card composer-questions-card agent-command-approval";
  block.setAttribute("role", "group");
  block.setAttribute("aria-label", "Command execution approval");
  block.innerHTML = `
    <div class="agent-questions-header">
      <span class="agent-questions-icon codicon codicon-terminal" aria-hidden="true"></span>
      <strong class="agent-questions-title">${escapeHtml(title)}</strong>
    </div>
    <div class="agent-questions-body">
      <button type="button" class="agent-command-approval-preview" aria-expanded="false" title="Click to show the full command">
        <code>${escapeHtml(String(command || "exec_command"))}</code>
      </button>
    </div>
    <div class="agent-command-approval-actions">
      <button type="button" class="agent-command-approval-button approve" data-command-decision="approve">Approve</button>
      <button type="button" class="agent-command-approval-button deny" data-command-decision="deny">Deny</button>
    </div>
  `;
  onLiveState?.({ kind: "question", title: "Command approval required", detail: "Waiting for your decision", meta: "PAUSED" });

  const preview = block.querySelector(".agent-command-approval-preview");
  const collapsePreview = () => {
    preview?.setAttribute("aria-expanded", "false");
    if (preview) preview.title = "Click to show the full command";
  };
  const outsidePointer = (event) => {
    if (preview?.getAttribute("aria-expanded") === "true" && !preview.contains(event.target)) collapsePreview();
  };
  document.addEventListener("pointerdown", outsidePointer);
  preview?.addEventListener("click", () => {
    const expanded = preview.getAttribute("aria-expanded") === "true";
    preview.setAttribute("aria-expanded", String(!expanded));
    preview.title = expanded ? "Click to show the full command" : "Click to collapse the command";
  });

  let resolveQuestions;
  let settled = false;
  const promise = new Promise((resolve) => { resolveQuestions = resolve; });
  const dismissPanel = () => {
    document.removeEventListener("pointerdown", outsidePointer);
    if (pendingComposerQuestionsBySession.get(ownerSessionId)?.block === block) {
      pendingComposerQuestionsBySession.delete(ownerSessionId);
    }
    syncComposerQuestionsForActiveSession();
  };
  const finish = (decision = "deny") => {
    if (settled) return;
    settled = true;
    block.dataset.decision = decision;
    block.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    onLiveState?.({
      kind: decision === "approve" ? "success" : "warn",
      title: decision === "approve" ? "Command approved" : "Command denied",
      detail: "Resuming the agent run.",
      meta: decision === "approve" ? "APPROVED" : "DENIED",
    });
    setTimeout(dismissPanel, 160);
    resolveQuestions({
      answers: [{ questionId: "approval", selectedOptionId: decision, freeText: "" }],
      skipped: false,
      requestId,
    });
  };
  block.querySelectorAll("[data-command-decision]").forEach((button) => {
    button.addEventListener("click", () => finish(button.dataset.commandDecision === "approve" ? "approve" : "deny"));
  });

  pendingComposerQuestionsBySession.set(ownerSessionId, {
    sessionId: ownerSessionId,
    block,
    promise,
    finish,
    abort: () => {
      if (settled) return;
      settled = true;
      dismissPanel();
      resolveQuestions({ answers: [], skipped: true, aborted: true, requestId });
    },
  });
  syncComposerQuestionsForActiveSession();
  return promise;
}

export function showComposerQuestionsPanel({
  reason = "The agent needs your input before continuing.",
  questions = [],
  requestId = "",
  approval = null,
  questionnaire = null,
  sessionId = appState.activeChatSessionId,
  subagentLabel = "",
  onLiveState = null,
} = {}) {
  const ownerSessionId = composerQuestionSessionId(sessionId);
  const existing = pendingComposerQuestionsBySession.get(ownerSessionId);
  if (existing) return existing.promise;
  if (!composerQuestionsEl) {
    return Promise.resolve({ answers: [], skipped: true, requestId });
  }

  const visibleQuestions = (Array.isArray(questions) ? questions : [])
    .filter((question) => question && Array.isArray(question.options) && question.options.length);
  if (!visibleQuestions.length) {
    return Promise.resolve({ answers: [], skipped: true, requestId });
  }
  if (approval?.kind === "command") {
    return showCommandApprovalPanel({ command: approval.command, ...(approval.title ? { title: approval.title } : {}), requestId, sessionId: ownerSessionId, onLiveState });
  }
  const isToolQuestionnaire = questionnaire?.kind === "agent_questions";

  const block = document.createElement("section");
  block.className = "agent-questions-card composer-questions-card";
  block.setAttribute("role", "form");
  block.setAttribute("aria-label", "Operator clarification questions");

  const questionBlocks = visibleQuestions.map((question, index) => {
    const options = questionOptionsWithFreeWrite(question);
    const hasRecommended = options.some((option) => option.recommended);
    const optionsHtml = options.map((option, optionIndex) => {
      const selectedByDefault = !isToolQuestionnaire && (option.recommended || (!hasRecommended && optionIndex === 0));
      const inputType = question.multiple ? "checkbox" : "radio";
      if (option.freeWrite) {
        return `
          <div class="agent-questions-option is-free-write">
            <input class="agent-questions-custom-radio" type="radio" name="agent-question-${escapeHtml(question.id)}" value="${escapeHtml(option.id)}" data-free-write="1"${selectedByDefault ? " checked" : ""}>
            <input type="text" class="agent-questions-freetext" data-question-id="${escapeHtml(question.id)}" placeholder="Or describe something else" aria-label="Or describe something else">
          </div>
        `;
      }
      return `
        <label class="agent-questions-option">
          <input type="${inputType}" name="agent-question-${escapeHtml(question.id)}" value="${escapeHtml(option.id)}" data-free-write="0"${selectedByDefault ? " checked" : ""}>
          <span class="agent-questions-option-label">${escapeHtml(option.label)}</span>
          ${option.recommended ? '<span class="agent-questions-recommended">(Recommended)</span>' : ""}
        </label>
      `;
    }).join("");
    const displayPrompt = `${question.prompt}${question.multiple ? " (Select more than one if applicable)" : ""}`;
    return `
      <fieldset class="agent-questions-field" data-question-id="${escapeHtml(question.id)}" data-question-index="${index}" data-question-prompt="${escapeHtml(displayPrompt)}" data-question-multiple="${String(Boolean(question.multiple))}"${index === 0 ? "" : " hidden"}>
        <legend class="agent-questions-field-legend">${escapeHtml(displayPrompt)}</legend>
        <div class="agent-questions-options">${optionsHtml}</div>
      </fieldset>
    `;
  }).join("");

  const subagentLabelHtml = String(subagentLabel || "").trim()
    ? `<div class="agent-questions-subagent-label">${escapeHtml(String(subagentLabel).trim())}</div>`
    : "";
  block.innerHTML = `
    ${subagentLabelHtml}
    <div class="agent-questions-header">
      <img class="agent-questions-icon agent-questions-icon-image" src="${QUESTION_ICON_SRC}" alt="" aria-hidden="true">
      <strong class="agent-questions-title">${escapeHtml(isToolQuestionnaire ? `1. ${visibleQuestions[0]?.prompt || "Need your input"}` : visibleQuestions[0]?.prompt || "Need your input")}</strong>
      <span class="agent-questions-step">1/${visibleQuestions.length}</span>
    </div>
    <div class="agent-questions-body">${questionBlocks}</div>
    <div class="agent-questions-actions">
      <button type="button" class="agent-questions-button icon" data-questions-action="back" aria-label="Previous question" title="Previous question" disabled><span class="codicon codicon-chevron-left" aria-hidden="true"></span></button>
      <button type="button" class="agent-questions-button icon" data-questions-action="submit" aria-label="${visibleQuestions.length > 1 ? "Next question" : "Submit answers"}" title="${visibleQuestions.length > 1 ? "Next question" : "Submit answers"}"><span class="codicon codicon-chevron-right" aria-hidden="true"></span></button>
      <button type="button" class="agent-questions-button secondary" data-questions-action="skip">Skip</button>
    </div>
  `;

  onLiveState?.({ kind: "question", title: "Waiting for your answers", detail: reason, meta: "PAUSED" });

  const questionFields = [...block.querySelectorAll(".agent-questions-field")];
  const titleLabel = block.querySelector(".agent-questions-title");
  const stepLabel = block.querySelector(".agent-questions-step");
  const backButton = block.querySelector("[data-questions-action='back']");
  const submitButton = block.querySelector("[data-questions-action='submit']");
  let activeQuestionIndex = 0;

  const syncFreeWrite = () => {
    block.querySelectorAll(".agent-questions-option.is-free-write").forEach((option) => {
      const input = option.querySelector("input[type='radio']");
      const textInput = option.querySelector(".agent-questions-freetext");
      if (!input || !textInput) return;
      option.classList.toggle("is-selected", input.checked);
    });
  };

  const syncQuestionStep = ({ focus = true } = {}) => {
    questionFields.forEach((field, index) => {
      field.hidden = index !== activeQuestionIndex;
    });
    const isLast = activeQuestionIndex >= questionFields.length - 1;
    const activeField = questionFields[activeQuestionIndex];
    if (titleLabel) {
      const prompt = activeField?.dataset.questionPrompt || "Need your input";
      titleLabel.textContent = isToolQuestionnaire ? `${activeQuestionIndex + 1}. ${prompt}` : prompt;
    }
    if (stepLabel) stepLabel.textContent = `${activeQuestionIndex + 1}/${questionFields.length}`;
    if (backButton) backButton.disabled = activeQuestionIndex === 0;
    if (submitButton) {
      const actionLabel = isLast ? "Submit answers" : "Next question";
      submitButton.setAttribute("aria-label", actionLabel);
      submitButton.title = actionLabel;
    }
    if (focus) {
      const selected = activeField?.querySelector("input:checked");
      const customText = selected?.dataset.freeWrite === "1"
        ? activeField?.querySelector(".agent-questions-freetext")
        : null;
      (customText || selected || activeField?.querySelector("input[type='radio'], input[type='checkbox']"))?.focus();
    }
  };

  block.querySelectorAll("input[type='radio']").forEach((input) => {
    input.addEventListener("change", () => {
      syncFreeWrite();
      if (isToolQuestionnaire && input.checked && input.dataset.freeWrite !== "1") {
        queueMicrotask(() => submitButton?.click());
      }
    });
  });
  block.querySelectorAll(".agent-questions-option.is-free-write").forEach((option) => {
    const radio = option.querySelector("input[type='radio']");
    const textInput = option.querySelector(".agent-questions-freetext");
    if (!radio || !textInput) return;
    const field = option.closest(".agent-questions-field");
    const selectCustomAnswer = () => {
      radio.checked = true;
      field?.querySelectorAll("input[type='checkbox']").forEach((checkbox) => { checkbox.checked = false; });
      syncFreeWrite();
    };
    textInput.addEventListener("focus", selectCustomAnswer);
    textInput.addEventListener("input", selectCustomAnswer);
    textInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (String(textInput.value || "").trim()) submitButton?.click();
    });
    option.addEventListener("click", (event) => {
      if (event.target === textInput) return;
      selectCustomAnswer();
      textInput.focus();
    });
    field?.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        if (!checkbox.checked) return;
        radio.checked = false;
        syncFreeWrite();
      });
    });
  });
  syncFreeWrite();
  syncQuestionStep();

  let resolveQuestions;
  let settled = false;
  const promise = new Promise((resolve) => { resolveQuestions = resolve; });

  const collectAnswers = () => {
    const answers = [];
    block.querySelectorAll(".agent-questions-field").forEach((field) => {
      const questionId = field.dataset.questionId || "";
      if (!questionId) return;
      const freeWriteSelected = field.querySelector("input[data-free-write='1']:checked");
      const freeText = String(field.querySelector(".agent-questions-freetext")?.value || "").trim();
      if (freeWriteSelected) {
        answers.push({ questionId, selectedOptionId: COMPOSER_FREE_WRITE_ID, freeText });
        return;
      }
      const selectedInputs = [...field.querySelectorAll("input[type='radio']:checked, input[type='checkbox']:checked")]
        .filter((input) => input.dataset.freeWrite !== "1");
      const selected = selectedInputs[0];
      if (!selected) return;
      answers.push(field.dataset.questionMultiple === "true"
        ? { questionId, selectedOptionIds: selectedInputs.map((input) => input.value), freeText: "" }
        : { questionId, selectedOptionId: selected.value, freeText: "" });
    });
    return answers;
  };

  const dismissPanel = () => {
    if (pendingComposerQuestionsBySession.get(ownerSessionId)?.block === block) {
      pendingComposerQuestionsBySession.delete(ownerSessionId);
    }
    syncComposerQuestionsForActiveSession();
  };

  const finish = (skipped = false) => {
    if (settled) return;
    settled = true;
    const answers = skipped ? [] : collectAnswers();
    block.dataset.decision = skipped ? "skipped" : "answered";
    block.querySelectorAll("button, input, textarea").forEach((el) => { el.disabled = true; });
    if (stepLabel) stepLabel.textContent = skipped ? "Skipped" : "Answered";
    onLiveState?.({
      kind: skipped ? "warn" : "success",
      title: skipped ? "Questions skipped" : "Answers submitted",
      detail: skipped ? "The agent will continue without your input." : "Resuming the agent run.",
      meta: skipped ? "SKIPPED" : "ANSWERED",
    });
    setTimeout(dismissPanel, skipped ? 0 : 160);
    resolveQuestions({ answers, skipped, requestId });
  };

  submitButton.addEventListener("click", () => {
    const activeField = questionFields[activeQuestionIndex];
    const freeWriteSelected = activeField?.querySelector("input[data-free-write='1']:checked");
    if (freeWriteSelected && !String(activeField.querySelector(".agent-questions-freetext")?.value || "").trim()) {
      activeField.querySelector(".agent-questions-freetext")?.focus();
      return;
    }
    if (!activeField?.querySelector("input[type='radio']:checked, input[type='checkbox']:checked")) {
      activeField?.querySelector("input[type='radio'], input[type='checkbox']")?.focus();
      return;
    }
    if (activeQuestionIndex < questionFields.length - 1) {
      activeQuestionIndex += 1;
      syncQuestionStep();
      return;
    }
    finish(false);
  });
  backButton.addEventListener("click", () => {
    if (activeQuestionIndex <= 0) return;
    activeQuestionIndex -= 1;
    syncQuestionStep();
  });
  block.querySelector("[data-questions-action='skip']").addEventListener("click", () => finish(true));

  pendingComposerQuestionsBySession.set(ownerSessionId, {
    sessionId: ownerSessionId,
    requestId: String(requestId || ""),
    block,
    promise,
    finish,
    abort: () => {
      if (settled) return;
      settled = true;
      dismissPanel();
      resolveQuestions({ answers: [], skipped: true, aborted: true, requestId });
    },
  });
  syncComposerQuestionsForActiveSession();
  return promise;
}

export function dismissEscalatedQuestionSurfaces(payload = {}) {
  const requestId = String(payload.questionRequestId || "");
  const parentSessionId = chatSessionIdForRuntimeId(payload.sessionId || payload.parentSessionId || "");
  const childSessionId = String(payload.childSessionId || "");
  if (parentSessionId) {
    const orchestratorPending = pendingOrchestratorEscalatedQuestions.get(parentSessionId);
    if (orchestratorPending && (!requestId || orchestratorPending.requestId === requestId)) {
      orchestratorPending.abort?.();
      pendingOrchestratorEscalatedQuestions.delete(parentSessionId);
    }
  }
  if (childSessionId) {
    const ownerId = composerQuestionSessionId(childSessionId);
    const childPending = pendingComposerQuestionsBySession.get(ownerId);
    if (childPending && (!requestId || childPending.requestId === requestId)) {
      childPending.abort?.();
    }
  }
}

export async function presentOrchestratorEscalatedQuestion(payload = {}) {
  const parentSessionId = chatSessionIdForRuntimeId(payload.sessionId || "");
  const requestId = String(payload.questionRequestId || "");
  if (!parentSessionId || !requestId) return;
  const existing = pendingOrchestratorEscalatedQuestions.get(parentSessionId);
  if (existing?.requestId === requestId) return existing.handling;
  if (existing) existing.abort?.();

  const handling = (async () => {
    const responsePromise = showComposerQuestionsPanel({
      reason: payload.reason || "A delegated sub-agent needs your input before continuing.",
      questions: payload.questions || [],
      requestId,
      sessionId: parentSessionId,
      subagentLabel: payload.subagentLabel || "",
    });
    const composerPending = pendingComposerQuestionsBySession.get(parentSessionId);
    pendingOrchestratorEscalatedQuestions.set(parentSessionId, {
      requestId,
      childSessionId: String(payload.childSessionId || ""),
      abort: () => composerPending?.abort?.(),
      handling,
    });
    const response = await responsePromise;
    pendingOrchestratorEscalatedQuestions.delete(parentSessionId);
    if (response?.aborted || response?.requestId !== requestId) return;
    await window.api.agentResolveQuestions?.({
      requestId,
      answers: response?.answers || [],
      skipped: Boolean(response?.skipped),
    });
  })();

  handling.catch(() => {}).finally(() => {
    if (pendingOrchestratorEscalatedQuestions.get(parentSessionId)?.requestId === requestId) {
      pendingOrchestratorEscalatedQuestions.delete(parentSessionId);
    }
  });
  return handling;
}

export function dismissOrchestratorEscalatedForChild(childSessionId = "") {
  const childId = String(childSessionId || "");
  if (!childId) return;
  for (const [parentSessionId, pending] of pendingOrchestratorEscalatedQuestions.entries()) {
    if (pending.childSessionId === childId) {
      pending.abort?.();
      pendingOrchestratorEscalatedQuestions.delete(parentSessionId);
    }
  }
}

export function dismissOrchestratorEscalatedQuestionsForStop(run) {
  for (const sessionId of chatStopIdsForRun(run)) {
    const parentSessionId = chatSessionIdForRuntimeId(sessionId);
    const pending = pendingOrchestratorEscalatedQuestions.get(parentSessionId);
    pending?.abort?.();
    pendingOrchestratorEscalatedQuestions.delete(parentSessionId);
    dismissOrchestratorEscalatedForChild(sessionId);
  }
}
