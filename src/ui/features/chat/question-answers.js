/* The answered form of an ask_questions call: an "Asked question" row in the
 * run's work flow, at the point the agent asked, that expands to the questions
 * and the answers given. The record is built from the tool call and its
 * result, so live runs and reloaded chats render the same row. */

export const QUESTION_ANSWER_CLASS = "agent-question-answer";
export const QUESTION_ICON_SRC = "assets/icons/question_chat_icon.svg";
const FREE_WRITE_ID = "free_write";
const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 6;

function text(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

function toolArgs(tool = {}) {
  const args = tool.args ?? tool.arguments ?? tool.input ?? {};
  if (typeof args === "string") {
    try { return JSON.parse(args) || {}; } catch { return {}; }
  }
  return args && typeof args === "object" ? args : {};
}

/** Mirrors the tool's option ids and recommended-first order. */
function offeredOptions(rawChoices = []) {
  const options = (Array.isArray(rawChoices) ? rawChoices : []).slice(0, MAX_OPTIONS).map((choice, index) => ({
    id: text(choice?.id || `choice-${index + 1}`, 64),
    label: text(choice?.choice ?? choice?.label, 160),
    recommended: Boolean(choice?.recommended),
  })).filter((option) => option.id && option.label);
  const recommended = options.findIndex((option) => option.recommended);
  if (recommended > 0) options.unshift(options.splice(recommended, 1)[0]);
  return options;
}

export function questionAnswerRecord(tool = {}, result = {}) {
  const args = toolArgs(tool);
  const answers = Array.isArray(result?.answers) ? result.answers : [];
  const rawQuestions = Array.isArray(args.questions) ? args.questions.slice(0, MAX_QUESTIONS) : [];
  let questions = rawQuestions.map((raw, index) => {
    const id = text(raw?.id || `q-${index + 1}`, 64);
    const answer = answers.find((item) => item?.questionId === id);
    const chosen = Array.isArray(answer?.selectedChoiceIds) ? answer.selectedChoiceIds.map(String) : [];
    const customIndex = chosen.indexOf(FREE_WRITE_ID);
    return {
      prompt: text(raw?.question || answer?.question, 500),
      multiple: Boolean(raw?.multiple),
      options: offeredOptions(raw?.choices).map((option) => ({ label: option.label, recommended: option.recommended, selected: chosen.includes(option.id) })),
      custom: customIndex >= 0 ? text(answer?.selectedChoices?.[customIndex], 2000) : "",
    };
  }).filter((question) => question.prompt);
  // Without the call arguments, the result alone still says what was chosen.
  if (!questions.length) {
    questions = answers.slice(0, MAX_QUESTIONS).map((answer) => ({
      prompt: text(answer?.question, 500),
      multiple: false,
      options: (Array.isArray(answer?.selectedChoices) ? answer.selectedChoices : []).map((label) => ({ label: text(label, 160), recommended: false, selected: true })),
      custom: "",
    })).filter((question) => question.prompt);
  }
  const answered = questions.some((question) => question.custom || question.options.some((option) => option.selected));
  return {
    type: "questions",
    lane: "activity",
    reason: text(args.reason, 500),
    skipped: Boolean(result?.skipped) || !answered,
    questions,
  };
}

export function normalizeQuestionAnswerRecord(record = {}) {
  const questions = (Array.isArray(record.questions) ? record.questions : []).slice(0, MAX_QUESTIONS).map((question) => ({
    prompt: text(question?.prompt, 500),
    multiple: Boolean(question?.multiple),
    options: (Array.isArray(question?.options) ? question.options : []).slice(0, MAX_OPTIONS).map((option) => ({
      label: text(option?.label, 160),
      recommended: Boolean(option?.recommended),
      selected: Boolean(option?.selected),
    })).filter((option) => option.label),
    custom: text(question?.custom, 2000),
  })).filter((question) => question.prompt);
  if (!questions.length) return null;
  return { type: "questions", lane: "activity", reason: text(record.reason, 500), skipped: Boolean(record.skipped), questions };
}

// Saved transcripts cross IPC, which caps nesting depth. The record travels
// as one JSON string so questions and options add no depth to the event.
const MAX_EVENT_RECORD = 20_000;

export function questionAnswerEvent(record) {
  const normalized = normalizeQuestionAnswerRecord(record);
  if (!normalized) return null;
  const serialized = JSON.stringify(normalized);
  if (serialized.length > MAX_EVENT_RECORD) return null;
  return { type: "questions", lane: "activity", record: serialized };
}

export function questionAnswerFromEvent(event = {}) {
  if (typeof event?.record !== "string") return normalizeQuestionAnswerRecord(event);
  try {
    return normalizeQuestionAnswerRecord(JSON.parse(event.record));
  } catch {
    return null;
  }
}

function element(doc, tag, className, content = "") {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

function answerLines(question) {
  const lines = question.options.filter((option) => option.selected).map((option) => option.label);
  if (question.custom) lines.push(question.custom);
  return lines;
}

/** A collapsed "Asked question" row that expands to the questions and the answers given. */
export function createQuestionAnswerCard(record, doc = globalThis.document) {
  const normalized = normalizeQuestionAnswerRecord(record);
  if (!normalized || !doc) return null;
  const fold = element(doc, "div", QUESTION_ANSWER_CLASS);
  fold.dataset.lane = "activity";
  fold.dataset.record = JSON.stringify(normalized);
  fold.dataset.state = normalized.skipped ? "skipped" : "answered";
  fold.dataset.expanded = "false";
  const toggle = element(doc, "button", "agent-question-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  const count = normalized.questions.length;
  // Same verb/detail treatment as "Ran Command <name>".
  const label = element(doc, "span", "agent-question-toggle-text");
  label.append(
    element(doc, "span", "agent-tool-verb", "Asked"),
    doc.createTextNode(" "),
    element(doc, "span", "agent-tool-detail", count > 1 ? `${count} questions` : "question"),
  );
  toggle.append(label);
  const body = element(doc, "div", "agent-question-body");
  const card = element(doc, "div", "agent-qa-card");
  card.setAttribute("aria-label", normalized.skipped ? "Agent questions, skipped" : "Agent questions and your answers");
  for (const question of normalized.questions) {
    const item = element(doc, "div", "agent-qa-item");
    const head = element(doc, "div", "agent-qa-question");
    const icon = element(doc, "img", "agent-qa-icon");
    icon.src = QUESTION_ICON_SRC;
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    head.append(icon, element(doc, "span", "agent-qa-prompt", question.prompt));
    item.append(head);
    const lines = answerLines(question);
    if (lines.length) {
      for (const line of lines) item.append(element(doc, "div", "agent-qa-answer", line));
    } else {
      item.append(element(doc, "div", "agent-qa-answer is-skipped", "Skipped"));
    }
    card.append(item);
  }
  body.append(card);
  fold.append(toggle, body);
  return fold;
}

export function readQuestionAnswerCard(card) {
  try {
    return normalizeQuestionAnswerRecord(JSON.parse(card?.dataset?.record || "null") || {});
  } catch {
    return null;
  }
}
