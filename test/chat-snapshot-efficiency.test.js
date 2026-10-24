"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

test("live snapshots reuse finished exchanges and invalidate changed turns before observer delivery", async () => {
  const { captureChatSnapshot, captureChatTranscript } = await import("../src/ui/features/chat/chat-transcript.js");
  const dom = new JSDOM(`<div id="messages">${Array.from({ length: 30 }, (_, i) => `<div class="chat-exchange"><div class="chat-exchange-body"><div class="chat-turn user"><div class="chat-box-content">Task ${i}</div></div><div class="agent-response-host"><div class="chat-turn assistant"><div class="assistant-reply" data-raw-md="Reply ${i}">Reply ${i}</div></div></div></div></div>`).join("")}</div>`);
  try {
    const root = dom.window.document.querySelector("#messages");
    let sanitizations = 0;
    const sanitize = html => { sanitizations++; return html; };
    const first = captureChatSnapshot(root, sanitize);
    assert.deepEqual(first.transcript, captureChatTranscript(root));
    assert.equal(first.messagesHtml, root.innerHTML);
    assert.equal(sanitizations, 30);
    captureChatSnapshot(root, sanitize);
    assert.equal(sanitizations, 30, "unchanged snapshots do not parse and sanitize finished history again");
    const reply = root.querySelector(".assistant-reply");
    reply.dataset.rawMd = "Corrected reply";
    reply.textContent = "Corrected reply";
    const updated = captureChatSnapshot(root, sanitize);
    assert.equal(sanitizations, 31, "only the changed exchange is recaptured");
    assert.deepEqual(updated.transcript, captureChatTranscript(root));
    root.prepend(root.lastElementChild);
    assert.deepEqual(captureChatSnapshot(root, sanitize).transcript, captureChatTranscript(root), "run IDs follow the reordered history");
    root.firstElementChild.remove();
    assert.deepEqual(captureChatSnapshot(root, sanitize).transcript, captureChatTranscript(root), "removed exchanges do not reappear");
  } finally { dom.window.close(); }
});

test("cached HTML retains sanitization and does not expose comment text", async () => {
  const { captureChatSnapshot } = await import("../src/ui/features/chat/chat-transcript.js");
  const dom = new JSDOM('<div id="messages"><!--internal comment--><div class="chat-exchange"><img src="x" onerror="bad()"><script>bad()</script>safe</div></div>');
  try {
    const root = dom.window.document.querySelector("#messages");
    const purify = require("dompurify")(dom.window);
    const sanitize = html => purify.sanitize(html);
    assert.equal(captureChatSnapshot(root, sanitize).messagesHtml, sanitize(root.innerHTML));
    root.querySelector("img").setAttribute("onload", "bad()");
    const changed = captureChatSnapshot(root, sanitize).messagesHtml;
    assert.equal(changed.includes("bad()"), false);
    assert.equal(changed.includes("internal comment"), false);
  } finally { dom.window.close(); }
});
