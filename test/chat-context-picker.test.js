"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(require("node:path").join(__dirname, "../src/ui/bootstrap.js"), "utf8");
const picker = source.slice(source.indexOf("let fileTagSuggestions ="), source.indexOf("function expandSlashCommand("));
const scoring = source.slice(source.indexOf("function scoreQuickMatch("), source.indexOf("function buildCommandItems("));

async function fixture(text = "@", terminals = []) {
  const tags = await import("../src/ui/features/chat/file-tags.js");
  const dom = new JSDOM('<div><div id="slash" hidden></div><div id="input" contenteditable="true" tabindex="0"></div></div>');
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const input = dom.window.document.querySelector("#input");
  input.textContent = text;
  input.focus();
  dom.window.getSelection().collapse(input.firstChild, text.length);
  const sessions = [
    { id: "current-ui", memorySessionId: "session_current", memoryProjectId: "proj_here", title: "Current" },
    { id: "source-ui", memorySessionId: "session_auth", memoryProjectId: "proj_here", title: "Auth investigation", updatedAt: "2026-10-14" },
    { id: "foreign-ui", memorySessionId: "session_other", memoryProjectId: "proj_other", title: "Auth other project" },
  ];
  const context = { ...tags, document: dom.window.document, window: dom.window, Node: dom.window.Node,
    rootPath: "G:/project", dirMapCache: "ready", chatInput: input, slashCommandSuggestions: dom.window.document.querySelector("#slash"),
    chatSessions: sessions, closedChatSessions: [], archivedChatSessions: [], activeChatSession: () => sessions[0],
    ToolParser: { parseProjectFiles: () => ["src/auth.js", "README.md"] },
    SetiIconTheme: { iconForFile: () => ({ glyph: "f", color: "#888" }) }, refreshDirMap: async () => {},
  };
  dom.window.api = { terminalReferences: async ({ workspace, includeHistory }) => {
    assert.equal(workspace, "G:/project");
    return { ok: true, terminals: typeof terminals === "function" ? terminals(includeHistory) : terminals };
  } };
  vm.createContext(context);
  vm.runInContext(`${scoring}\n${picker}\nfunction onChatInputChange(){ renderFileTagSuggestions(); }`, context);
  context.renderFileTagSuggestions();
  return { context, input, document: dom.window.document, window: dom.window };
}

test("$ immediately lists project terminals with origin icons and only running rows have a spinner", async t => {
  const rows = [
    { id: "terminal-one", name: "powershell : curl -I ht...", command: "curl -I https://auth.example.test", origin: "agent", running: true },
    { id: "terminal-two", name: "powershell : cls", command: "cls", origin: "user", running: false },
  ];
  const { context, input, document, window } = await fixture("$", rows);
  t.after(() => window.close());
  await new Promise(resolve => setImmediate(resolve));
  const options = [...document.querySelectorAll(".file-tag-option")];
  assert.deepEqual(options.map(row => row.textContent), ["powershell : curl -I ht...", "powershell : cls"]);
  assert.ok(options[0].querySelector(".terminal-tag-agent"));
  assert.ok(options[1].querySelector(".terminal-tag-user"));
  assert.equal(options[0].querySelector(".terminal-tag-running").getAttribute("aria-label"), "Running");
  assert.equal(options[1].querySelector(".terminal-tag-running"), null);
  assert.equal(context.handleFileTagKeydown({ key: "ArrowDown" }), true);
  assert.equal(context.handleFileTagKeydown({ key: "Enter" }), true);
  assert.equal(input.textContent, "[terminal: terminal-two powershell%20%3A%20cls user] ");
  assert.equal(input.querySelector(".terminal-tag-chip").dataset.terminalId, "terminal-two");
  rows[0].running = false;
  input.textContent = "$auth";
  window.getSelection().collapse(input.firstChild, 5);
  context.renderFileTagSuggestions();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.querySelectorAll(".file-tag-option").length, 1);
  assert.equal(document.querySelector(".terminal-tag-running"), null);
  context.closeFileTagSuggestions();
});

test("metadata refresh retains saved commands and merges live process aliases without reloading histories", async t => {
  const calls = [];
  const { context, document, window } = await fixture("$", includeHistory => {
    calls.push(includeHistory);
    return includeHistory ? [
      { id: "chat:old:call", name: "powershell : Get-Conten...", processId: "process-one", command: "Get-Content file", origin: "agent", saved: true, running: true },
      { id: "chat:older:call", name: "powershell : cls", command: "cls", origin: "agent", saved: true, running: false },
    ] : [
      { id: "process:process-one", name: "powershell : Get-Conten...", processId: "process-one", command: "Get-Content file", origin: "agent", running: false },
    ];
  });
  t.after(() => window.close());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.querySelectorAll(".file-tag-option").length, 2);
  assert.equal(document.querySelectorAll(".terminal-tag-running").length, 1);
  context.refreshTerminalsForTags(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [true, false]);
  assert.equal(document.querySelectorAll(".file-tag-option").length, 2);
  assert.equal(document.querySelectorAll(".terminal-tag-running").length, 0);
  context.handleFileTagKeydown({ key: "Enter" });
  assert.equal(document.querySelector(".terminal-tag-chip").dataset.terminalId, "chat:old:call");
});

test("background refresh preserves manual scrolling while keyboard navigation and a changed query reveal their selection", async t => {
  const rows = Array.from({ length: 15 }, (_, index) => ({
    id: `command-${index}`, name: `powershell : command-${index}`, command: `command-${index}`,
    origin: "user", running: index === 0,
  }));
  const { context, document, input, window } = await fixture("$", rows);
  t.after(() => window.close());
  await new Promise(resolve => setImmediate(resolve));
  const list = document.querySelector("#file-tag-suggestions");
  let reveals = 0;
  window.HTMLElement.prototype.scrollIntoView = function () {
    reveals++;
    this.parentElement.scrollTop = 0;
  };
  list.scrollTop = 145;
  rows[0].running = false;
  context.refreshTerminalsForTags(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(list.scrollTop, 145, "Refreshing running indicators must not scroll back to the first row");
  assert.equal(reveals, 0);
  assert.equal(document.querySelector(".terminal-tag-running"), null);
  assert.equal(context.handleFileTagKeydown({ key: "ArrowDown" }), true);
  assert.equal(reveals, 1);
  list.scrollTop = 145;
  input.textContent = "$command-14";
  window.getSelection().collapse(input.firstChild, input.textContent.length);
  context.renderFileTagSuggestions();
  assert.equal(list.scrollTop, 0);
  assert.equal(reveals, 2);
  assert.equal(document.querySelectorAll(".file-tag-option").length, 1);
});

test("the production picker includes chat icons, excludes foreign/self chats, and Enter inserts a chat chip", async () => {
  const { context, input, document } = await fixture();
  assert.equal(document.querySelectorAll(".chat-tag-icon").length, 1);
  assert.equal(document.querySelector(".file-tag-option").textContent, "Auth investigationChat");
  assert.equal(document.querySelectorAll(".file-tag-option").length, 3);
  assert.equal(input.getAttribute("aria-expanded"), "true");
  assert.equal(context.handleFileTagKeydown({ key: "Enter" }), true);
  assert.equal(input.textContent, "[chat: session_auth Auth%20investigation] ");
  assert.equal(input.querySelector(".chat-tag-chip").dataset.label, "Auth investigation");
  assert.equal(input.getAttribute("aria-expanded"), "false");
});

test("the production picker filters both kinds, accepts files with Tab, and reopens after editing a dismissed query", async () => {
  const { context, input, document, window } = await fixture("Compare @auth");
  assert.equal(document.querySelectorAll(".file-tag-option").length, 2);
  assert.equal(context.handleFileTagKeydown({ key: "ArrowDown" }), true);
  assert.equal(input.getAttribute("aria-activedescendant"), "file-tag-option-1");
  assert.equal(context.handleFileTagKeydown({ key: "Escape" }), true);
  const node = input.firstChild;
  node.data = "Compare @auth.j";
  window.getSelection().collapse(node, node.data.length);
  context.renderFileTagSuggestions();
  assert.equal(document.querySelector("#file-tag-suggestions").hidden, false);
  assert.equal(document.querySelectorAll(".file-tag-option").length, 1);
  assert.equal(context.handleFileTagKeydown({ key: "Tab" }), true);
  assert.equal(input.textContent, "Compare [file: src/auth.js] ");
});
