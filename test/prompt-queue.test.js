"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

async function load() {
  return import("../src/ui/features/chat/prompt-queue.js");
}

test("prompt queue keeps 1-based order and sends the top item first", async () => {
  const { enqueuePrompt, shiftPromptQueue, movePrompt, updatePromptAt, removePromptAt } = await load();
  let queue = enqueuePrompt({}, "first");
  queue = enqueuePrompt(queue, "second");
  queue = enqueuePrompt(queue, "third");
  assert.deepEqual(queue, {
    1: { user_prompt: "first" },
    2: { user_prompt: "second" },
    3: { user_prompt: "third" },
  });

  queue = movePrompt(queue, 3, 1);
  assert.equal(queue[1].user_prompt, "third");
  assert.equal(queue[2].user_prompt, "first");

  queue = updatePromptAt(queue, 2, "first edited");
  assert.equal(queue[2].user_prompt, "first edited");

  const shifted = shiftPromptQueue(queue);
  assert.equal(shifted.prompt, "third");
  assert.equal(shifted.queue[1].user_prompt, "first edited");
  assert.equal(shifted.queue[2].user_prompt, "second");

  const removed = removePromptAt(shifted.queue, 1);
  assert.equal(removed[1].user_prompt, "second");
  assert.equal(removed[2], undefined);
});
