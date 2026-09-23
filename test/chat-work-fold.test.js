"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

async function load() {
  return import("../src/ui/features/chat/chat-work-fold.js");
}

const dom = new JSDOM("<!doctype html><body></body>");
globalThis.document = dom.window.document;

function node(className, { text = "", hidden = false } = {}) {
  const el = document.createElement("div");
  el.className = className;
  if (text) el.textContent = text;
  if (hidden) el.hidden = true;
  return el;
}

function assistantTurn(...nodes) {
  const turn = document.createElement("div");
  turn.className = "chat-turn assistant";
  for (const child of nodes) turn.appendChild(child);
  return turn;
}

test("the work fold is a container with a single collapse point", async () => {
  const { createWorkFold, workFoldHeader, workFoldBody, setWorkFoldExpanded, toggleWorkFold } = await load();
  const fold = createWorkFold({ label: "Worked for 5s", final: true });
  const header = workFoldHeader(fold);
  const body = workFoldBody(fold);
  assert.equal(fold.className, "agent-work-fold");
  assert.equal(header.tagName, "BUTTON");
  assert.deepEqual([...fold.children], [header, body]);

  setWorkFoldExpanded(fold, false);
  assert.equal(fold.dataset.expanded, "false");
  assert.equal(header.getAttribute("aria-expanded"), "false");
  toggleWorkFold(fold);
  assert.equal(fold.dataset.expanded, "true");
  assert.equal(header.getAttribute("aria-expanded"), "true");
  assert.equal(fold.dataset.userToggled, "true");
});

// Tool rows force their own display with !important, so hiding them one by one
// can never work. They have to sit inside the element that gets hidden.
test("every row the run produced ends up inside the fold body", async () => {
  const { ensureTurnWorkFold, workFoldBody } = await load();
  const card = node("agent-file-row tool-card", { text: "Read targets" });
  const thinking = node("agent-thinking-fold", { text: "Thought briefly" });
  const command = node("agent-command-event", { text: "npm test" });
  const narration = node("assistant-reply", { text: "Let me look at the workspace." });
  const turn = assistantTurn(narration, card, thinking, command);

  const fold = ensureTurnWorkFold(turn);
  const body = workFoldBody(fold);
  for (const child of [narration, card, thinking, command]) {
    assert.equal(child.parentElement, body);
  }
  assert.deepEqual([...turn.children], [fold]);
});

test("only the reply that closed the run leaves the fold", async () => {
  const { ensureTurnWorkFold, workFoldBody, promoteFinalAnswer } = await load();
  const opening = node("assistant-reply", { text: "Let me look." });
  const firstCard = node("agent-file-row tool-card", { text: "Read ." });
  const middle = node("assistant-reply", { text: "Found a targets directory." });
  const secondCard = node("agent-file-row tool-card", { text: "Read targets" });
  const answer = node("assistant-reply", { text: "Done - here is what it holds." });
  const footer = node("assistant-reply-footer");
  const turn = assistantTurn(opening, firstCard, middle, secondCard, answer, footer);

  const fold = ensureTurnWorkFold(turn);
  const body = workFoldBody(fold);
  assert.equal(promoteFinalAnswer(turn), answer);
  assert.equal(answer.previousElementSibling, fold);
  assert.equal(footer.parentElement, turn);
  for (const child of [opening, firstCard, middle, secondCard]) {
    assert.equal(child.parentElement, body);
  }

  // Running again must not peel a second reply out of the body.
  assert.equal(promoteFinalAnswer(turn), answer);
  assert.equal(middle.parentElement, body);
});

test("progress replies that still have work after them stay inside the fold", async () => {
  const { ensureTurnWorkFold, workFoldBody, promoteFinalAnswer } = await load();
  const opening = node("assistant-reply", { text: "Let me look." });
  const firstCard = node("agent-file-row tool-card", { text: "Read ." });
  const middle = node("assistant-reply", { text: "Found a targets directory." });
  const secondCard = node("agent-file-row tool-card", { text: "Read targets" });
  const turn = assistantTurn(opening, firstCard, middle, secondCard);

  const fold = ensureTurnWorkFold(turn);
  const body = workFoldBody(fold);
  assert.equal(promoteFinalAnswer(turn), null);
  assert.deepEqual([...turn.children], [fold]);
  for (const child of [opening, firstCard, middle, secondCard]) {
    assert.equal(child.parentElement, body);
  }
});

test("the reply before a stop-round recap is the visible answer", async () => {
  const { ensureTurnWorkFold, workFoldBody, promoteFinalAnswer } = await load();
  const opening = node("assistant-reply", { text: "Let me look." });
  const card = node("agent-file-row tool-card", { text: "Read notes" });
  const answer = node("assistant-reply", { text: "Here is the gathered inventory." });
  const recap = node("assistant-reply", { text: "Yes — I can see everything. Short recap." });
  recap.dataset.stopRound = "true";
  const turn = assistantTurn(opening, card, answer, recap);

  const fold = ensureTurnWorkFold(turn);
  const body = workFoldBody(fold);
  assert.equal(promoteFinalAnswer(turn), answer);
  assert.equal(answer.previousElementSibling, fold);
  assert.equal(recap.parentElement, body);
  assert.equal(opening.parentElement, body);
  assert.equal(card.parentElement, body);
});

test("the last real reply stays the visible answer even if an empty segment follows later work", async () => {
  const { ensureTurnWorkFold, workFoldBody, promoteFinalAnswer } = await load();
  const opening = node("assistant-reply", { text: "Checking the workspace." });
  const card = node("agent-file-row tool-card", { text: "Read README.md" });
  const answer = node("assistant-reply", { text: "The start script is electron ." });
  const emptyAfterStop = node("assistant-reply", { hidden: true });
  const turn = assistantTurn(opening, card, answer, emptyAfterStop);

  ensureTurnWorkFold(turn);
  assert.equal(promoteFinalAnswer(turn), answer);
  assert.equal(answer.previousElementSibling, turn.querySelector(".agent-work-fold"));
  assert.equal(opening.parentElement, workFoldBody(turn.querySelector(".agent-work-fold")));
  assert.equal(card.parentElement, workFoldBody(turn.querySelector(".agent-work-fold")));
});

test("blank reply placeholders are never promoted as the answer", async () => {
  const { ensureTurnWorkFold, promoteFinalAnswer } = await load();
  const answer = node("assistant-reply", { text: "The real answer." });
  const pending = node("assistant-reply", { hidden: true });
  const whitespace = node("assistant-reply", { text: "   " });
  const turn = assistantTurn(node("tool-card", { text: "Read ." }), answer, pending, whitespace);

  ensureTurnWorkFold(turn);
  assert.equal(promoteFinalAnswer(turn), answer);
});

test("a run that produced no work keeps its replies on the turn", async () => {
  const { ensureTurnWorkFold, hasWorkNode, workFoldBody, unwrapWorkFold, turnWorkFold } = await load();
  const reply = node("assistant-reply", { text: "Just an answer." });
  const turn = assistantTurn(reply);

  const fold = ensureTurnWorkFold(turn);
  assert.equal(hasWorkNode(workFoldBody(fold)), false);
  unwrapWorkFold(fold);
  assert.equal(turnWorkFold(turn), null);
  assert.equal(reply.parentElement, turn);
});

test("a flat snapshot migrates into a fold and keeps its recorded duration", async () => {
  const {
    ensureTurnWorkFold,
    workFoldHeader,
    workFoldBody,
    isFinishedWorkFold,
    promoteFinalAnswer,
    setWorkFoldExpanded,
  } = await load();
  const legacy = document.createElement("button");
  legacy.className = "agent-work-header agent-status-line";
  legacy.dataset.final = "true";
  legacy.dataset.workedForMs = "50000";
  legacy.innerHTML = '<span class="agent-status-text">Worked for 50s</span>';
  const card = node("agent-file-row tool-card", { text: "Read targets" });
  const answer = node("assistant-reply", { text: "Done." });
  const turn = assistantTurn(legacy, card, answer);

  const fold = ensureTurnWorkFold(turn);
  const header = workFoldHeader(fold);
  assert.equal(header.dataset.workedForMs, "50000");
  assert.equal(header.querySelector(".agent-status-text").textContent, "Worked for 50s");
  assert.ok(isFinishedWorkFold(fold));
  assert.equal(card.parentElement, workFoldBody(fold));
  assert.equal(turn.querySelectorAll(".agent-work-header").length, 1);

  promoteFinalAnswer(turn);
  setWorkFoldExpanded(fold, false);
  assert.equal(answer.parentElement, turn);
  assert.equal(fold.dataset.expanded, "false");
});

test("a finished label makes the fold foldable and carries a caret", async () => {
  const { createWorkFold, workFoldHeader } = await load();
  const live = createWorkFold({ label: "Worked for 3s" });
  assert.equal(workFoldHeader(live).dataset.foldable, "true");
  assert.ok(workFoldHeader(live).querySelector(".agent-work-caret"));

  const planning = createWorkFold({ label: "Planning" });
  assert.equal(workFoldHeader(planning).dataset.foldable, "false");
  assert.equal(workFoldHeader(planning).querySelector(".agent-work-caret"), null);
  assert.equal(workFoldHeader(planning).hasAttribute("aria-expanded"), false);
});

test("adopting more work does not swallow an already promoted answer", async () => {
  const { ensureTurnWorkFold, promoteFinalAnswer, workFoldBody } = await load();
  const opening = node("assistant-reply", { text: "Let me look." });
  const card = node("agent-file-row tool-card", { text: "Read targets" });
  const answer = node("assistant-reply", { text: "Done." });
  const turn = assistantTurn(opening, card, answer);

  ensureTurnWorkFold(turn);
  assert.equal(promoteFinalAnswer(turn), answer);
  answer.dataset.workVerdict = "true";

  const extra = node("agent-file-row tool-card", { text: "Read more" });
  turn.appendChild(extra);
  const fold = ensureTurnWorkFold(turn);
  assert.equal(extra.parentElement, workFoldBody(fold));
  assert.equal(answer.parentElement, turn);
  assert.equal(answer.previousElementSibling, fold);
});
