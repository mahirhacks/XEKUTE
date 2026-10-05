"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

async function setup() {
  const { createChatScroller } = await import("../src/ui/features/chat/chat-scroll.js");
  const dom = new JSDOM('<div id="messages"></div>');
  const { window } = dom;
  const messages = window.document.getElementById("messages");
  let height = 1000;
  Object.defineProperties(messages, {
    clientHeight: { get: () => 300 },
    scrollHeight: { get: () => height },
  });
  const frames = new Map();
  let id = 0;
  window.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
  window.cancelAnimationFrame = (key) => frames.delete(key);
  messages.scrollTo = ({ top }) => {
    messages.scrollTop = top;
    messages.dispatchEvent(new window.Event("scroll"));
  };
  const scroller = createChatScroller(messages);
  return {
    messages, scroller, window,
    grow(value) { height = value; },
    scroll(top) {
      messages.scrollTop = top;
      messages.dispatchEvent(new window.Event("scroll"));
    },
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
  };
}

test("following measures the new content height after rendering", async () => {
  const s = await setup();
  s.scroller.follow();
  s.grow(1600);
  s.flush();
  assert.equal(s.messages.scrollTop, 1300);
  s.scroller.destroy();
});

test("an upward wheel movement pauses following until the reader scrolls down again", async () => {
  const s = await setup();
  s.scroller.follow();
  s.flush();
  s.messages.dispatchEvent(new s.window.WheelEvent("wheel", { deltaY: -4 }));
  s.scroll(696);
  s.grow(1800);
  s.messages.dispatchEvent(new s.window.CustomEvent("markdown-rendered"));
  s.flush();
  assert.equal(s.messages.scrollTop, 696);
  assert.equal(s.scroller.following, false);
  s.scroll(1500);
  s.scroller.follow();
  s.flush();
  assert.equal(s.messages.scrollTop, 1500);
  assert.equal(s.scroller.following, true);
  s.scroller.destroy();
});

test("scrolling down to the latest content resumes following within a forgiving threshold", async () => {
  const s = await setup();
  s.scroller.follow();
  s.flush();
  s.scroll(200);
  assert.equal(s.scroller.following, false);
  s.scroll(670);
  assert.equal(s.scroller.following, true);
  s.grow(1200);
  s.scroller.follow();
  s.flush();
  assert.equal(s.messages.scrollTop, 900);
  s.scroller.destroy();
});

test("keyboard navigation cancels an already queued follow", async () => {
  const s = await setup();
  s.scroller.follow();
  s.messages.dispatchEvent(new s.window.KeyboardEvent("keydown", { key: "PageUp" }));
  s.flush();
  assert.equal(s.messages.scrollTop, 0);
  assert.equal(s.scroller.following, false);
  s.scroller.destroy();
});

test("inspecting a tool result pauses follow before its content expands", async () => {
  const s = await setup();
  s.scroller.follow();
  s.flush();
  s.messages.innerHTML = '<details><summary class="agent-command-summary">Command output</summary><pre>Result</pre></details>';
  s.messages.querySelector("summary").click();
  s.grow(1800);
  s.scroller.follow();
  s.flush();
  assert.equal(s.messages.scrollTop, 700);
  assert.equal(s.scroller.following, false);
  s.scroller.destroy();
});

test("selecting transcript text keeps the reader in place during further output", async () => {
  const s = await setup();
  s.messages.textContent = "Read this paragraph";
  const range = s.window.document.createRange();
  range.selectNodeContents(s.messages);
  s.window.getSelection().addRange(range);
  s.window.document.dispatchEvent(new s.window.Event("selectionchange"));
  s.scroller.follow();
  s.flush();
  assert.equal(s.messages.scrollTop, 0);
  assert.equal(s.scroller.following, false);
  s.scroller.destroy();
});
