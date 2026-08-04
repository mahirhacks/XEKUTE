/* Operator clarification questions — JSON schema, path builder, and model formatting. */

const { slugifyTopic } = require("../planning/plan-document");

const QUESTIONS_DIR = "questions";
const FREE_WRITE_ID = "free_write";
const FREE_WRITE_LABEL = "Other (write your own answer)";
const DOCUMENT_VERSION = 1;

function buildQuestionsDocumentPath(topic = "", now = new Date()) {
  const slug = slugifyTopic(topic) || "clarification";
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `${QUESTIONS_DIR}/clarification-${slug}_${date}_${time}.json`;
}

function isOperatorQuestionsFilePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return Boolean(normalized && /^questions\/clarification-[^/]+\.json$/i.test(normalized));
}

function normalizeOption(raw = {}, index = 0) {
  const id = String(raw.id || `opt-${index + 1}`).trim().slice(0, 64);
  const label = String(raw.label || "").trim().slice(0, 160);
  if (!id || !label) return null;
  if (id === FREE_WRITE_ID || raw.freeWrite) return null;
  return {
    id,
    label,
    recommended: Boolean(raw.recommended),
    freeWrite: false,
  };
}

function normalizeQuestions(rawQuestions) {
  const input = (Array.isArray(rawQuestions) ? rawQuestions : []).slice(0, 3);
  if (!input.length) return { error: "At least one question is required.", code: "MISSING_QUESTIONS" };

  const questions = [];
  for (let index = 0; index < input.length; index += 1) {
    const raw = input[index] || {};
    const id = String(raw.id || `q-${index + 1}`).trim().slice(0, 64);
    const prompt = String(raw.prompt || raw.question || "").trim().slice(0, 500);
    if (!id || !prompt) return { error: `Question ${index + 1} requires id and prompt.`, code: "INVALID_QUESTION" };

    const rawOptions = (Array.isArray(raw.options) ? raw.options : []).slice(0, 3);
    if (!rawOptions.length) return { error: `Question "${id}" requires at least one option.`, code: "MISSING_OPTIONS" };

    const options = rawOptions
      .map((option, optionIndex) => normalizeOption(option, optionIndex))
      .filter(Boolean);
    if (!options.length) return { error: `Question "${id}" requires at least one valid option.`, code: "MISSING_OPTIONS" };

    const recommendedCount = options.filter((option) => option.recommended).length;
    if (recommendedCount > 1) {
      options.forEach((option, optionIndex) => {
        option.recommended = optionIndex === options.findIndex((row) => row.recommended);
      });
    }
    if (!options.some((option) => option.recommended)) options[0].recommended = true;

    options.push({
      id: FREE_WRITE_ID,
      label: FREE_WRITE_LABEL,
      recommended: false,
      freeWrite: true,
    });

    questions.push({ id, prompt, options });
  }

  return { questions };
}

function buildDocument({ reason = "", topic = "", questions = [], requestId = "" } = {}) {
  const now = new Date();
  const id = String(requestId || `req-${now.getTime()}`).slice(0, 80);
  return {
    version: DOCUMENT_VERSION,
    requestId: id,
    createdAt: now.toISOString(),
    reason: String(reason || "").trim().slice(0, 2000),
    topic: String(topic || "").trim().slice(0, 120),
    status: "pending",
    questions,
    answers: null,
    answeredAt: null,
  };
}

function applyAnswers(document = {}, answers = [], { skipped = false, expired = false } = {}) {
  const base = document && typeof document === "object" ? { ...document } : {};
  const answeredAt = new Date().toISOString();
  if (skipped || expired || !Array.isArray(answers) || !answers.length) {
    return {
      ...base,
      status: expired ? "expired" : "skipped",
      answers: [],
      answeredAt,
    };
  }

  const normalizedAnswers = answers.map((answer) => ({
    questionId: String(answer?.questionId || "").slice(0, 64),
    selectedOptionId: String(answer?.selectedOptionId || "").slice(0, 64),
    freeText: String(answer?.freeText || "").trim().slice(0, 4000),
  })).filter((answer) => answer.questionId);

  return {
    ...base,
    status: "answered",
    answers: normalizedAnswers,
    answeredAt,
  };
}

function answerLabelForQuestion(question = {}, answer = {}) {
  const option = (question.options || []).find((row) => row.id === answer.selectedOptionId);
  if (option?.freeWrite || answer.selectedOptionId === FREE_WRITE_ID) {
    return answer.freeText || "(no free-text answer provided)";
  }
  return option?.label || answer.selectedOptionId || "(unknown)";
}

function formatAnswersForModel(document = {}) {
  const lines = [
    "OPERATOR CLARIFICATION RESPONSE",
    document.reason ? `Reason: ${document.reason}` : "",
    "",
  ];
  const answers = Array.isArray(document.answers) ? document.answers : [];
  const questions = Array.isArray(document.questions) ? document.questions : [];

  for (const answer of answers) {
    const question = questions.find((row) => row.id === answer.questionId);
    const prompt = question?.prompt || answer.questionId;
    lines.push(`- ${prompt}: ${answerLabelForQuestion(question, answer)}`);
  }

  lines.push("", "Continue the run using these answers. Do not re-ask the same questions unless the operator's answers are ambiguous.");
  return lines.filter((line, index) => line !== "" || index === 0 || lines[index - 1] !== "").join("\n").trim();
}

function formatSkippedForModel(document = {}) {
  return [
    "OPERATOR CLARIFICATION SKIPPED",
    document.reason ? `Original reason: ${document.reason}` : "",
    "The operator skipped or did not answer before timeout. Proceed with stated unknowns, mark dependent items as blocked, or ask a narrower question set.",
  ].filter(Boolean).join("\n");
}

function buildPolicyPrecedenceHints({ roe = {}, reason = "" } = {}) {
  const passiveOnly = /\bpassive\b/i.test(String(reason || ""));
  const scanDisabled = roe?.allowAutomatedScanning === false || roe?.allow_scan === false;
  const activeDisabled = roe?.allowActiveTesting === false || roe?.allow_active_recon === false || roe?.allow_reachability_check === false;
  return [
    "Operator answers override inferred scope and RoE when policy_precedence conflicts arise.",
    passiveOnly || scanDisabled || activeDisabled
      ? "Treat engagement as passive-only: use list_datasets and ingest_assessment_records for passive-recon; do not run active scanners until operator confirms."
      : "Active testing is permitted when RoE flags allow; still prefer evidence-backed observations over speculation.",
    "Dataset ingest and passive evidence sinks remain available even when automated scanning is disabled.",
  ];
}

module.exports = {
  QUESTIONS_DIR,
  FREE_WRITE_ID,
  FREE_WRITE_LABEL,
  DOCUMENT_VERSION,
  buildQuestionsDocumentPath,
  isOperatorQuestionsFilePath,
  normalizeQuestions,
  buildDocument,
  applyAnswers,
  formatAnswersForModel,
  formatSkippedForModel,
  answerLabelForQuestion,
  buildPolicyPrecedenceHints,
};
