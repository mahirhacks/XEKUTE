const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context.js");
const { createAskQuestionsTool, normalizeQuestions } = require("../src/agent/tools/process/ask-questions.js");

function context() {
  return projectExecutionContext(createExecutionContext({
    invocationId: "ask-questions-test",
    toolName: "ask_questions",
    role: "agent",
    authority: "ask_for_approval",
    workspace: { root: path.resolve(".") },
    sessionId: "session-1",
    mode: "agent",
  }));
}

const input = {
  reason: "Need the operator's preferences",
  questions: [
    {
      id: "color",
      question: "What is your favorite color?",
      choices: [
        { id: "blue", choice: "Blue" },
        { id: "red", choice: "Red", recommended: true },
        { id: "yellow", choice: "Yellow" },
      ],
    },
    {
      id: "activities",
      question: "What do you like?",
      multiple: true,
      choices: [
        { id: "walking", choice: "Walking", recommended: true },
        { id: "running", choice: "Running" },
        { id: "sleeping", choice: "Sleeping" },
      ],
    },
  ],
};

test("question normalization moves exactly one recommended choice to the top", () => {
  const result = normalizeQuestions(input);
  assert.equal(result.ok, true);
  assert.equal(result.questions[0].options[0].id, "red");
  assert.equal(result.questions[0].options[0].recommended, true);
  assert.equal(result.questions[0].options.filter((choice) => choice.recommended).length, 1);
  assert.equal(result.questions[1].multiple, true);
});

test("ask_questions blocks on the UI provider and returns single- and multi-select answers", async () => {
  const tool = createAskQuestionsTool();
  let proposal;
  const result = await tool.execute(input, context(), {
    questionProvider: async (value) => {
      proposal = value;
      return {
        skipped: false,
        answers: [
          { questionId: "color", selectedOptionId: "red" },
          { questionId: "activities", selectedOptionIds: ["walking", "running"] },
        ],
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(proposal.questionnaire.kind, "agent_questions");
  assert.equal(proposal.expiresInMs, 0);
  assert.equal(proposal.questions[0].options[0].label, "Red");
  assert.deepEqual(result.value.answers, [
    { questionId: "color", question: "What is your favorite color?", selectedChoiceIds: ["red"], selectedChoices: ["Red"] },
    { questionId: "activities", question: "What do you like?", selectedChoiceIds: ["walking", "running"], selectedChoices: ["Walking", "Running"] },
  ]);
});

test("ask_questions preserves a skipped decision without inventing answers", async () => {
  const result = await createAskQuestionsTool().execute(input, context(), {
    questionProvider: async () => ({ skipped: true, answers: [] }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.skipped, true);
  assert.deepEqual(result.value.answers, []);
});

test("ask_questions fails clearly when the UI provider is unavailable", async () => {
  const result = await createAskQuestionsTool().execute(input, context(), {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "QUESTION_PROVIDER_UNAVAILABLE");
});
