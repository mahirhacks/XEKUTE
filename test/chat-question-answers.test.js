"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const loadAnswers = () => import("../src/ui/features/chat/question-answers.js");
const loadTranscript = () => import("../src/ui/features/chat/chat-transcript.js");
const loadFold = () => import("../src/ui/features/chat/chat-work-fold.js");

const askTool = {
  toolName: "ask_questions",
  args: {
    reason: "Need the scope",
    questions: [
      {
        id: "scope",
        question: "Which areas should I map?",
        choices: [
          { id: "all", choice: "Everything in scope" },
          { id: "auth", choice: "Only auth flows", recommended: true },
          { id: "payments", choice: "Payments" },
        ],
      },
      {
        id: "depth",
        question: "How deep?",
        choices: [{ choice: "Passive only" }, { choice: "Light probing" }],
      },
    ],
  },
};

test("the answered card lists every offered option and marks the chosen one", async () => {
  const { questionAnswerRecord } = await loadAnswers();
  const record = questionAnswerRecord(askTool, {
    answers: [
      { questionId: "scope", selectedChoiceIds: ["payments"], selectedChoices: ["Payments"] },
      { questionId: "depth", selectedChoiceIds: ["free_write"], selectedChoices: ["Only GET requests"] },
    ],
  });
  assert.equal(record.skipped, false);
  // Recommended first, as the panel showed it.
  assert.deepEqual(record.questions[0].options.map((option) => [option.label, option.selected]), [
    ["Only auth flows", false],
    ["Everything in scope", false],
    ["Payments", true],
  ]);
  assert.equal(record.questions[1].custom, "Only GET requests");
  assert.ok(record.questions[1].options.every((option) => !option.selected));
});

test("a skipped questionnaire is recorded as skipped", async () => {
  const { questionAnswerRecord } = await loadAnswers();
  const record = questionAnswerRecord(askTool, { skipped: true, answers: [] });
  assert.equal(record.skipped, true);
  assert.equal(record.questions.length, 2);
});

test("the Asked question row expands to each question and only the answer given", async () => {
  const { questionAnswerRecord, createQuestionAnswerCard } = await loadAnswers();
  const { document } = new JSDOM("<!doctype html><body></body>").window;
  const row = createQuestionAnswerCard(questionAnswerRecord(askTool, {
    answers: [
      { questionId: "scope", selectedChoiceIds: ["all"], selectedChoices: ["Everything in scope"] },
      { questionId: "depth", selectedChoiceIds: ["free_write"], selectedChoices: ["Only GET requests"] },
    ],
  }), document);
  assert.equal(row.dataset.expanded, "false");
  assert.equal(row.querySelector(".agent-question-toggle").textContent, "Asked 2 questions");
  const [first, second] = row.querySelectorAll(".agent-qa-item");
  assert.equal(first.querySelector(".agent-qa-icon").getAttribute("src"), "assets/icons/question_chat_icon.svg");
  assert.equal(first.querySelector(".agent-qa-prompt").textContent, "Which areas should I map?");
  assert.deepEqual([...first.querySelectorAll(".agent-qa-answer")].map((el) => el.textContent), ["Everything in scope"]);
  assert.deepEqual([...second.querySelectorAll(".agent-qa-answer")].map((el) => el.textContent), ["Only GET requests"]);
  assert.equal(row.querySelectorAll(".codicon-check, .agent-qa-option").length, 0);
});

test("a single question reads Asked question and a skipped one says so", async () => {
  const { questionAnswerRecord, createQuestionAnswerCard } = await loadAnswers();
  const { document } = new JSDOM("<!doctype html><body></body>").window;
  const tool = { args: { questions: [askTool.args.questions[0]] } };
  const row = createQuestionAnswerCard(questionAnswerRecord(tool, { skipped: true, answers: [] }), document);
  assert.equal(row.querySelector(".agent-question-toggle").textContent, "Asked question");
  assert.equal(row.querySelector(".agent-qa-answer.is-skipped").textContent, "Skipped");
});

test("answered questions survive a transcript save and reload", async () => {
  const { questionAnswerRecord, createQuestionAnswerCard } = await loadAnswers();
  const { captureChatTranscript, normalizeUiTranscript } = await loadTranscript();
  const dom = new JSDOM(`
    <div id="messages"><div class="chat-exchange"><div class="chat-exchange-body">
      <div class="chat-turn user"><div class="chat-box-content">map the site</div></div>
      <div class="agent-response-host"><div class="agent-run-chunk"><div class="chat-turn assistant">
        <div class="assistant-reply" data-raw-md="Before I start">Before I start</div>
      </div></div></div>
    </div></div></div>`);
  const turn = dom.window.document.querySelector(".chat-turn.assistant");
  turn.append(createQuestionAnswerCard(questionAnswerRecord(askTool, {
    answers: [{ questionId: "scope", selectedChoiceIds: ["auth"], selectedChoices: ["Only auth flows"] }],
  }), dom.window.document));
  const restored = normalizeUiTranscript(captureChatTranscript(dom.window.document.querySelector("#messages")));
  const events = restored.runs[0].timeline.find((item) => item.type === "assistant").events;
  assert.deepEqual(events.map((event) => event.type), ["chat", "questions"]);
  const { questionAnswerFromEvent } = await loadAnswers();
  assert.equal(questionAnswerFromEvent(events[1]).questions[0].options.find((option) => option.selected).label, "Only auth flows");
});

test("a saved question event stays within the IPC nesting limit", async () => {
  const { questionAnswerRecord, questionAnswerEvent } = await loadAnswers();
  const { validateIpcRequest } = require("../src/contracts/ipc/IpcContracts.js");
  const record = questionAnswerRecord(askTool, { answers: [{ questionId: "scope", selectedChoiceIds: ["auth"] }] });
  // The shape chat history saves: payload → uiTranscript → runs → timeline → events.
  const save = (event) => validateIpcRequest("chat-history:save-before-close", [{ uiTranscript: { runs: [{ timeline: [{ type: "assistant", events: [event] }] }] } }]);
  assert.equal(save(questionAnswerEvent(record)), null);
  assert.match(String(save(record)?.error || save(record)?.message || JSON.stringify(save(record))), /nesting/);
});

test("the Asked question row stays in the work flow where it was asked", async () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  globalThis.document = dom.window.document;
  const { ensureTurnWorkFold, promoteFinalAnswer, workFoldBody, turnWorkFold } = await loadFold();
  const { questionAnswerRecord, createQuestionAnswerCard } = await loadAnswers();
  const turn = document.createElement("div");
  turn.className = "chat-turn assistant";
  const before = document.createElement("div");
  before.className = "tool-card";
  const asked = createQuestionAnswerCard(questionAnswerRecord(askTool, { answers: [{ questionId: "scope", selectedChoiceIds: ["auth"] }] }), document);
  const after = document.createElement("div");
  after.className = "agent-command-event";
  const reply = document.createElement("div");
  reply.className = "assistant-reply";
  reply.textContent = "Here is the report.";
  turn.append(before, asked, after, reply);
  ensureTurnWorkFold(turn);
  promoteFinalAnswer(turn);
  const body = workFoldBody(turnWorkFold(turn));
  assert.deepEqual([...body.children].map((child) => child.className.split(" ")[0]), ["tool-card", "agent-question-answer", "agent-command-event"]);
  assert.deepEqual([...turn.children].map((child) => child.className), ["agent-work-fold", "assistant-reply"]);
});
