"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const load = () => import("../src/ui/features/chat/file-tags.js");

function scoreQuickMatch(text, query) {
  const hay = String(text || "").toLowerCase();
  const clean = String(query || "").trim().toLowerCase();
  if (!clean) return 1;
  if (hay === clean) return 1000;
  if (hay.startsWith(clean)) return 700;
  if (hay.includes(clean)) return 500 - hay.indexOf(clean);
  let pos = -1;
  let score = 0;
  for (const char of clean) {
    pos = hay.indexOf(char, pos + 1);
    if (pos < 0) return 0;
    score += Math.max(1, 40 - pos);
  }
  return score;
}

test("@ opens a query at the start, mid-sentence and at the end, but not inside a word", async () => {
  const { fileTagQueryAt } = await load();
  assert.deepEqual(fileTagQueryAt("@"), { query: "", start: 0 });
  assert.deepEqual(fileTagQueryAt("fix @boot"), { query: "boot", start: 4 });
  assert.deepEqual(fileTagQueryAt("look at\n@src/ui"), { query: "src/ui", start: 8 });
  assert.equal(fileTagQueryAt("mail me@host"), null);
  assert.equal(fileTagQueryAt("fix @boot now"), null);
});

test("at most the limit of best files comes back, and typing more narrows them", async () => {
  const { topFileTagMatches } = await load();
  const files = [
    "src/ui/bootstrap.js", "src/ui/boot-screen.js", "docs/boot.md", "test/bootstrap.test.js",
    "src/app/main.js", "src/ui/styles/base.css", "README.md", "scripts/boot.sh", "src/booking.js",
  ];
  const broad = topFileTagMatches(files, "boo", scoreQuickMatch, 5);
  assert.equal(broad.length, 5);
  assert.equal(topFileTagMatches(Array.from({ length: 40 }, (_, i) => `src/f${i}.js`), "f", scoreQuickMatch).length, 15);
  assert.ok(!broad.includes("src/app/main.js"));
  assert.deepEqual(topFileTagMatches(files, "bootstrap.t", scoreQuickMatch), ["test/bootstrap.test.js"]);
  assert.deepEqual(topFileTagMatches(files, "zzz", scoreQuickMatch), []);
});

test("an empty query prefers shallow paths", async () => {
  const { topFileTagMatches } = await load();
  const files = ["a/b/c/deep.js", "a/mid.js", "top.js", "z.md"];
  assert.deepEqual(topFileTagMatches(files, "", scoreQuickMatch, 2), ["z.md", "top.js"]);
});

test("markers render as chips that keep the full marker as text", async () => {
  const { appendFileTagText, splitFileTags, fileTagDisplayText } = await load();
  const text = "fix [file: src/ui/bootstrap.js] and [file: README.md] please";
  assert.deepEqual(splitFileTags(text), [
    { text: "fix " }, { path: "src/ui/bootstrap.js" }, { text: " and " }, { path: "README.md" }, { text: " please" },
  ]);
  assert.equal(fileTagDisplayText(text), "fix bootstrap.js and README.md please");

  const { document } = new JSDOM("<div id=box></div>").window;
  const box = document.querySelector("#box");
  appendFileTagText(box, text);
  const chips = [...box.querySelectorAll(".file-tag-chip")];
  assert.deepEqual(chips.map((chip) => [chip.dataset.label, chip.dataset.path, chip.getAttribute("contenteditable")]),
    [["bootstrap.js", "src/ui/bootstrap.js", "false"], ["README.md", "README.md", "false"]]);
  assert.equal(box.textContent, text);
});

test("chat and file chips round-trip through drafts and hide imported context", async () => {
  const { chatTagMarker, appendFileTagText, splitFileTags, fileTagDisplayText } = await load();
  const marker = chatTagMarker("session_auth", "Auth [User A] / B");
  const prompt = `Compare ${marker} with [file: src/auth.js]`;
  const stored = prompt + '\n\n<referenced_chat_context>\nprivate conversation\n</referenced_chat_context>';
  const { document } = new JSDOM('<div id="box"></div>').window;
  const box = document.querySelector("#box");
  appendFileTagText(box, stored);
  assert.equal(box.textContent, prompt);
  assert.equal(box.querySelector(".chat-tag-chip").dataset.sessionId, "session_auth");
  assert.equal(box.querySelector(".chat-tag-chip").dataset.label, "Auth [User A] / B");
  assert.equal(fileTagDisplayText(stored), "Compare Auth [User A] / B with auth.js");
  assert.deepEqual(splitFileTags(marker), [{ sessionId: "session_auth", title: "Auth [User A] / B" }]);
});

test("the picker searches saved project chats and files, excluding this chat and other projects", async () => {
  const { projectChatsForTags, topContextTagMatches } = await load();
  const chats = projectChatsForTags([
    { id: "current", memorySessionId: "session_current", memoryProjectId: "proj_here", title: "Current" },
    { id: "auth", memorySessionId: "session_auth", memoryProjectId: "proj_here", title: "Auth testing", updatedAt: "2026-10-14" },
    { id: "foreign", memorySessionId: "session_elsewhere", memoryProjectId: "proj_other", title: "Auth elsewhere" },
    { id: "unsaved", memoryProjectId: "proj_here", title: "Auth draft" },
  ], "current", "proj_here");
  assert.deepEqual(chats.map(chat => chat.sessionId), ["session_auth"]);
  const results = topContextTagMatches(["src/auth.js", "README.md"], chats, "auth", scoreQuickMatch);
  assert.deepEqual(results.map(item => item.kind), ["chat", "file"]);
  const initial = topContextTagMatches(Array.from({ length: 30 }, (_, i) => `f${i}.js`), chats, "", scoreQuickMatch);
  assert.equal(initial.length, 15);
  assert.equal(initial[0].sessionId, "session_auth");
});

test("terminal chips survive drafts/history and shell variables stay ordinary text", async () => {
  const { terminalTagMarker, appendFileTagText, fileTagDisplayText, terminalTagQueryAt, splitFileTags } = await load();
  const marker = terminalTagMarker("terminal-stable", "Check [auth] / headers", "agent");
  const text = 'Compare $env:PATH with ' + marker;
  const { document } = new JSDOM('<div id="box"></div>').window;
  const box = document.querySelector("#box");
  appendFileTagText(box, text);
  assert.equal(box.textContent, text);
  assert.equal(box.querySelectorAll(".terminal-tag-chip").length, 1);
  assert.equal(box.querySelector(".terminal-tag-chip").dataset.origin, "agent");
  assert.equal(fileTagDisplayText(text), "Compare $env:PATH with Check [auth] / headers");
  assert.deepEqual(splitFileTags("$PATH"), [{ text: "$PATH" }]);
  assert.deepEqual(terminalTagQueryAt("Compare $"), { kind: "terminal", query: "", start: 8 });
  assert.deepEqual(terminalTagQueryAt("$auth"), { kind: "terminal", query: "auth", start: 0 });
  assert.equal(terminalTagQueryAt("cost$money"), null);
});
