const test = require("node:test");
const assert = require("node:assert/strict");

const OperatorQuestions = require("../src/agent/controller/operator-questions.js");

test("buildQuestionsDocumentPath uses topic date and time slug", () => {
  const path = OperatorQuestions.buildQuestionsDocumentPath(
    "API auth scope",
    new Date("2026-08-03T07:31:00"),
  );
  assert.match(path, /^\.xekute\/questions\/clarification-api-auth-scope_2026-08-03_0731\.json$/);
});

test("normalizeQuestions appends free-write option and keeps one recommended", () => {
  const result = OperatorQuestions.normalizeQuestions([
    {
      id: "q1",
      prompt: "Which environment?",
      options: [
        { id: "staging", label: "Staging", recommended: true },
        { id: "prod", label: "Production", recommended: true },
      ],
    },
  ]);
  assert.equal(result.error, undefined);
  assert.equal(result.questions.length, 1);
  const options = result.questions[0].options;
  assert.equal(options.length, 3);
  assert.equal(options[options.length - 1].id, OperatorQuestions.FREE_WRITE_ID);
  assert.equal(options[options.length - 1].freeWrite, true);
  assert.equal(options.filter((row) => row.recommended).length, 1);
});

test("operator questions stay bounded to three questions and four options each", () => {
  const result = OperatorQuestions.normalizeQuestions(Array.from({ length: 5 }, (_, questionIndex) => ({
    id: `q${questionIndex + 1}`,
    prompt: `Question ${questionIndex + 1}?`,
    options: Array.from({ length: 5 }, (_, optionIndex) => ({
      id: `q${questionIndex + 1}-o${optionIndex + 1}`,
      label: `Choice ${optionIndex + 1}`,
      recommended: optionIndex === 0,
    })),
  })));
  assert.equal(result.questions.length, 3);
  assert.ok(result.questions.every((question) => question.options.length === 4));
});

test("applyAnswers and formatAnswersForModel render operator choices", () => {
  const normalized = OperatorQuestions.normalizeQuestions([
    {
      id: "q1",
      prompt: "Which environment?",
      options: [{ id: "staging", label: "Staging", recommended: true }],
    },
  ]);
  const document = OperatorQuestions.buildDocument({
    reason: "Need scope confirmation",
    questions: normalized.questions,
  });
  const answered = OperatorQuestions.applyAnswers(document, [
    { questionId: "q1", selectedOptionId: OperatorQuestions.FREE_WRITE_ID, freeText: "QA tenant only" },
  ]);
  const text = OperatorQuestions.formatAnswersForModel(answered);
  assert.match(text, /OPERATOR CLARIFICATION RESPONSE/);
  assert.match(text, /Which environment\?: QA tenant only/);
});

test("isOperatorQuestionsFilePath matches clarification json files", () => {
  assert.equal(
    OperatorQuestions.isOperatorQuestionsFilePath(".xekute/questions/clarification-api_2026-08-03_0731.json"),
    true,
  );
  assert.equal(OperatorQuestions.isOperatorQuestionsFilePath("plans/plan-api.md"), false);
});
