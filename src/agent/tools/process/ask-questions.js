"use strict";

const { assertToolAdapter } = require("../../../contracts/tool/tool-adapter.js");
const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context.js");

const ASK_QUESTIONS_INPUT_SCHEMA = Object.freeze({
  type: "object",
  description: "Ask the operator one to three concise multiple-choice questions. Use this whenever user input, a preference, or a decision is needed instead of asking in plain assistant text. Single-select choices advance immediately; multi-select choices wait for Next.",
  properties: {
    reason: { type: "string", minLength: 1, maxLength: 500, description: "Brief reason the answer is needed." },
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        required: ["question", "choices"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 64 },
          question: { type: "string", minLength: 1, maxLength: 500 },
          multiple: { type: "boolean", description: "Allow more than one choice." },
          choices: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              required: ["choice"],
              properties: {
                id: { type: "string", minLength: 1, maxLength: 64 },
                choice: { type: "string", minLength: 1, maxLength: 160 },
                recommended: { type: "boolean" },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
});

function normalizeQuestions(input = {}) {
  const rawQuestions = Array.isArray(input.questions) ? input.questions.slice(0, 3) : [];
  if (!rawQuestions.length) return { ok: false, error: "At least one question is required." };
  const questions = [];
  for (let questionIndex = 0; questionIndex < rawQuestions.length; questionIndex += 1) {
    const raw = rawQuestions[questionIndex] || {};
    const id = String(raw.id || `q-${questionIndex + 1}`).trim().slice(0, 64);
    const prompt = String(raw.question || "").trim().slice(0, 500);
    const rawChoices = Array.isArray(raw.choices) ? raw.choices.slice(0, 6) : [];
    if (!id || !prompt || rawChoices.length < 2) {
      return { ok: false, error: `Question ${questionIndex + 1} requires text and at least two choices.` };
    }
    const options = rawChoices.map((choice, choiceIndex) => ({
      id: String(choice?.id || `choice-${choiceIndex + 1}`).trim().slice(0, 64),
      label: String(choice?.choice || "").trim().slice(0, 160),
      recommended: Boolean(choice?.recommended),
      freeWrite: false,
    })).filter((choice) => choice.id && choice.label);
    if (options.length < 2 || new Set(options.map((choice) => choice.id)).size !== options.length) {
      return { ok: false, error: `Question ${questionIndex + 1} requires at least two uniquely identified choices.` };
    }
    const recommendedIndex = Math.max(0, options.findIndex((choice) => choice.recommended));
    options.forEach((choice, index) => { choice.recommended = index === recommendedIndex; });
    if (recommendedIndex > 0) options.unshift(options.splice(recommendedIndex, 1)[0]);
    questions.push({ id, prompt, multiple: Boolean(raw.multiple), options });
  }
  return { ok: true, questions };
}

function answerValue(questions, response = {}) {
  const answers = Array.isArray(response.answers) ? response.answers : [];
  return answers.map((answer) => {
    const question = questions.find((item) => item.id === answer?.questionId);
    const selectedIds = question?.multiple
      ? (Array.isArray(answer?.selectedOptionIds) ? answer.selectedOptionIds : [])
      : [String(answer?.selectedOptionId || "")].filter(Boolean);
    const selectedChoices = selectedIds.map((id) => question?.options.find((option) => option.id === id)?.label || id);
    return {
      questionId: String(answer?.questionId || ""),
      question: question?.prompt || "",
      selectedChoiceIds: selectedIds,
      selectedChoices,
    };
  }).filter((answer) => answer.questionId);
}

function createAskQuestionsTool() {
  return assertToolAdapter({
    name: "ask_questions",
    description: ASK_QUESTIONS_INPUT_SCHEMA.description,
    inputSchema: ASK_QUESTIONS_INPUT_SCHEMA,
    async execute(input, executionContext, runtime = {}) {
      if (!isRestrictedToolContext(executionContext)) {
        return { ok: false, error: { code: "INVALID_EXECUTION_CONTEXT", message: "ask_questions requires a restricted execution context projection", retryable: false } };
      }
      const normalized = normalizeQuestions(input);
      if (!normalized.ok) {
        return { ok: false, error: { code: "INVALID_QUESTIONS", message: normalized.error, retryable: false } };
      }
      if (typeof runtime.questionProvider !== "function") {
        return { ok: false, error: { code: "QUESTION_PROVIDER_UNAVAILABLE", message: "The operator question UI is unavailable.", retryable: true } };
      }
      const requestId = `tool-questions-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const response = await runtime.questionProvider({
        requestId,
        reason: String(input?.reason || "The agent needs your input before continuing.").trim().slice(0, 500),
        topic: "agent-questions",
        expiresInMs: 0,
        questionnaire: { kind: "agent_questions" },
        questions: normalized.questions,
      });
      return {
        ok: true,
        value: {
          skipped: Boolean(response?.skipped),
          answers: answerValue(normalized.questions, response),
        },
      };
    },
  });
}

module.exports = { ASK_QUESTIONS_INPUT_SCHEMA, createAskQuestionsTool, normalizeQuestions, answerValue };
