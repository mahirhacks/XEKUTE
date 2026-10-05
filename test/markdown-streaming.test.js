"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { Marked } = require("marked");
const createDOMPurify = require("dompurify");

const source = fs.readFileSync(path.join(__dirname, "../src/ui/core/markdown.js"), "utf8");

function setup() {
  const dom = new JSDOM("<div id='reply'></div>", { runScripts: "outside-only" });
  const frames = new Map();
  let nextFrame = 0;
  const { window } = dom;
  window.marked = new Marked();
  window.DOMPurify = createDOMPurify(window);
  window.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  vm.runInContext(source, dom.getInternalVMContext());
  return {
    renderer: window.MarkdownRenderer,
    reply: window.document.getElementById("reply"),
    window,
    flush() {
      const queued = [...frames.values()];
      frames.clear();
      queued.forEach((callback) => callback());
    },
  };
}

test("a queued stream frame cannot overwrite the final answer", () => {
  const { renderer, reply, flush } = setup();
  renderer.scheduleRender(reply, () => "An unfinished reply", true);
  renderer.renderToElement(reply, "The complete answer.");
  flush();
  assert.equal(reply.textContent.trim(), "The complete answer.");
  assert.equal(reply.dataset.rawMd, "The complete answer.");
});

test("completed prose and code keep their nodes and focus while the next paragraph streams", () => {
  const { renderer, reply, window, flush } = setup();
  const completed = "A completed paragraph.\n\n```js\nconst ready = true;\n```\n\n";
  renderer.renderToElement(reply, completed + "Next", { streaming: true });
  const paragraph = reply.querySelector("p");
  const code = reply.querySelector(".md-code-block");
  const copy = code.querySelector("button");
  copy.focus();
  renderer.scheduleRender(reply, () => completed + "Next paragraph grows.", true);
  flush();
  assert.equal(reply.querySelector("p"), paragraph);
  assert.equal(reply.querySelector(".md-code-block"), code);
  assert.equal(window.document.activeElement, copy);
  assert.match(reply.textContent, /Next paragraph grows\./);
});

test("updates coalesce to the latest text and notify only after it reaches the DOM", () => {
  const { renderer, reply, flush } = setup();
  const displayed = [];
  reply.addEventListener("markdown-rendered", () => displayed.push(reply.textContent.trim()));
  renderer.scheduleRender(reply, () => "First", true);
  renderer.scheduleRender(reply, () => "First and second", true);
  flush();
  assert.deepEqual(displayed, ["First and second"]);
});

test("a queued reasoning update is available for saving before the next paint", () => {
  const { renderer, reply } = setup();
  renderer.scheduleRender(reply, () => "The final reasoning token", true);
  assert.equal(reply.dataset.rawMd, "The final reasoning token");
  renderer.renderToElement(reply, reply.dataset.rawMd);
  assert.equal(reply.textContent.trim(), "The final reasoning token");
});

test("streaming markdown still sanitizes untrusted content", () => {
  const { renderer, reply } = setup();
  renderer.renderToElement(reply, '<img src="x" onerror="alert(1)"><script>alert(1)</script>\n\n[bad](javascript:alert(1))', { streaming: true });
  assert.equal(reply.querySelector("script, [onerror], [href^='javascript:']"), null);
});
