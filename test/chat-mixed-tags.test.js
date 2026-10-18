"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(path.join(__dirname, "../src/ui/bootstrap.js"), "utf8");
const definition = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

async function fileCollector(paths, activePath = "") {
  const tags = await import("../src/ui/features/chat/file-tags.js");
  const reads = [];
  const context = { ...tags, rootPath: "G:/workspace", dirMapCache: "ready",
    ToolParser: { parseProjectFiles: () => paths }, getActiveFileContext: () => ({ path: activePath }),
    readWorkspaceFile: async path => { reads.push(path); return { path, content: `Contents of ${path}` }; } };
  vm.createContext(context);
  vm.runInContext(definition("async function collectMentionedFiles(", "function renderMarkdown("), context);
  return { collect: text => context.collectMentionedFiles(text), reads };
}

test("explicit file tags load exact paths instead of three earlier basename matches", async () => {
  const fixture = await fileCollector(["a/config.json", "b/config.json", "c/config.json", "target/config.json"]);
  const files = await fixture.collect("Check [file: target/config.json]");
  assert.deepEqual(Array.from(files, file => file.path), ["target/config.json"]);
  assert.deepEqual(fixture.reads, ["target/config.json"]);
});

test("all explicitly tagged files load once while incidental mentions keep their limit", async () => {
  const paths = ["one.md", "two.md", "three.md", "four.md", "active.md"];
  const fixture = await fileCollector(paths, "active.md");
  const files = await fixture.collect(paths.map(path => `[file: ${path}]`).join(" ") + " [file: one.md]");
  assert.deepEqual(Array.from(files, file => file.path), ["one.md", "two.md", "three.md", "four.md"]);
  assert.equal(fixture.reads.length, 4);
  const incidental = await fileCollector(paths);
  assert.equal((await incidental.collect("one.md two.md three.md four.md")).length, 3);
});

test("file tags outside the project do not cause an unrelated single file to be attached", async () => {
  const fixture = await fileCollector(["only.md"]);
  assert.deepEqual(Array.from(await fixture.collect("[file: ../outside.md]")), []);
  assert.deepEqual(fixture.reads, []);
});

async function composer(t) {
  const tags = await import("../src/ui/features/chat/file-tags.js");
  const dom = new JSDOM('<div id="composer"><div id="input" contenteditable="true" tabindex="0"></div><div id="suggestions" hidden></div></div>');
  t.after(() => dom.window.close());
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const input = dom.window.document.querySelector("#input");
  const context = { ...tags, document: dom.window.document, window: dom.window, Node: dom.window.Node,
    chatInput: input, selectedSlashCommand: "", selectedSlashCommandEl: dom.window.document.createElement("span"),
    composerEl: dom.window.document.querySelector("#composer"), slashCommandSuggestions: dom.window.document.querySelector("#suggestions"),
    slashSuggestionItems: [], slashSuggestionIndex: -1, slashSuggestionQuery: "", slashSuggestionTarget: null, bugBountyReveal: 3,
    isRunningChatActive: () => false, syncChatInputPlaceholder() {}, resizeChatInput() {}, updateSendBtn() {},
    hideSlashCommandOverview() {}, showSlashCommandOverview() {},
    availableSlashCommands: () => [{ name: "/report", description: "Write a report", group: "system-command" },
      { name: "/create-skill", description: "Create a skill", group: "system-command" }] };
  vm.createContext(context);
  vm.runInContext(definition("function closeSlashSuggestions()", "let fileTagSuggestions ="), context);
  context.installChatInputEditorAdapter();
  function enter(text, offset) {
    input.value = text;
    input.focus();
    const node = input.lastChild;
    dom.window.getSelection().collapse(node, offset ?? node.data.length);
    context.renderSlashSuggestions();
  }
  return { context, input, enter, document: dom.window.document };
}

test("a skill selected after file, chat and terminal chips preserves every reference", async t => {
  const { context, input, enter, document } = await composer(t);
  const text = "Review [file: evidence.md] [chat: session_source Source] [terminal: terminal%3Aone Shell agent] /rep";
  enter(text);
  assert.equal(document.querySelector("#suggestions").hidden, false);
  assert.deepEqual(Array.from(document.querySelectorAll(".slash-command-name"), node => node.textContent), ["/report"]);
  document.querySelector(".slash-command-option").dispatchEvent(new document.defaultView.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  assert.equal(context.effectiveChatInputValue(), "/report Review [file: evidence.md] [chat: session_source Source] [terminal: terminal%3Aone Shell agent]");
  assert.equal(input.querySelectorAll(".selected-slash-command").length, 1);
  assert.equal(input.querySelectorAll(".file-tag-chip").length, 3);
});

test("keyboard skill selection at a middle caret preserves following text", async t => {
  const { context, enter } = await composer(t);
  enter("Review /rep after", "Review /rep".length);
  assert.equal(context.chooseSlashSuggestion(), true);
  assert.equal(context.effectiveChatInputValue(), "/report Review after");
});

test("a later skill replaces the selected skill and retains existing tags", async t => {
  const { context, input, enter } = await composer(t);
  context.setSelectedSlashCommand("/report");
  enter("[file: evidence.md] /create-s");
  context.chooseSlashSuggestion(0, { clicked: true });
  assert.equal(context.effectiveChatInputValue(), "/create-skill [file: evidence.md]");
  assert.equal(input.querySelectorAll(".selected-slash-command").length, 1);
});

test("slashes inside paths or file markers do not open the skill picker", async t => {
  const { enter, document } = await composer(t);
  enter("Look at src/rep");
  assert.equal(document.querySelector("#suggestions").hidden, true);
});
