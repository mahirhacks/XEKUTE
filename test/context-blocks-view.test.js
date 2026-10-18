"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeContextBlocks, summarizeContextBlocks, renderContextBlocksHtml, MAX_BLOCKS } = require("../src/ui/features/chat/context-blocks-view.js");

const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const formatTokenCount = (count) => (count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count));
const render = (blocks) => renderContextBlocksHtml(blocks, { escapeHtml, formatTokenCount });
const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("normalization clamps bad input and keeps only the newest blocks", () => {
  assert.deepEqual(normalizeContextBlocks(undefined), []);
  assert.deepEqual(normalizeContextBlocks([{ index: -4, tokens: "x", state: "weird", pinned: "yes", summary: "  a\n  b  " }]), [
    { index: 0, state: "in_context", tokens: 0, releasedTokens: 0, messages: 0, pinned: false, summary: "a b" },
  ]);
  const many = Array.from({ length: MAX_BLOCKS + 10 }, (_, index) => ({ index, tokens: 1 }));
  assert.equal(normalizeContextBlocks(many).length, MAX_BLOCKS);
  assert.equal(normalizeContextBlocks(many)[0].index, 10);
  assert.equal(normalizeContextBlocks([{ summary: "x".repeat(300) }])[0].summary.length, 80);
});

test("the summary counts released and pinned blocks and the tokens they freed", () => {
  assert.deepEqual(summarizeContextBlocks([
    { index: 0, state: "released", tokens: 90, releasedTokens: 1500 },
    { index: 1, state: "released", tokens: 80, releasedTokens: 900 },
    { index: 2, state: "in_context", tokens: 400, pinned: true },
    { index: 3, state: "in_context", tokens: 300 },
  ]), { total: 4, released: 2, pinned: 1, freedTokens: 2230 });
  assert.equal(render([]), "");
});

test("released blocks render greyed with no pin control and live blocks get one", () => {
  const html = render([
    { index: 0, state: "released", tokens: 90, releasedTokens: 1590, summary: "Scan <host>" },
    { index: 1, state: "in_context", tokens: 1200, summary: "Check TLS", pinned: true },
    { index: 2, state: "in_context", tokens: 350, summary: "Now" },
  ]);
  assert.match(html, /<span>Conversation blocks<\/span><span>1 released · 1\.5k freed · 1 pinned<\/span>/);
  assert.match(html, /<div class="context-block-row released" data-block-index="0">/);
  assert.match(html, /<span class="context-block-summary" title="Scan &lt;host&gt;">Scan &lt;host&gt;<\/span>/);
  assert.match(html, /<span class="context-block-tokens">released<\/span>/);
  assert.equal(/data-block-pin="0"/.test(html), false, "a released block cannot be pinned");
  assert.match(html, /<div class="context-block-row pinned" data-block-index="1">/);
  assert.match(html, /data-block-pin="1" aria-pressed="true"[^>]*><span class="codicon codicon-pinned"/);
  assert.match(html, /data-block-pin="2" aria-pressed="false"[^>]*><span class="codicon codicon-pin"/);
  assert.match(html, /<span class="context-block-tokens">1\.2k<\/span>/);
});

test("the renderer, preload and main process are wired for blocks, pinning and release notices", () => {
  const bootstrap = read("src/ui/bootstrap.js");
  assert.match(read("src/ui/core/runtime-modules.js"), /import "\.\.\/features\/chat\/context-blocks-view\.js";/);
  assert.match(bootstrap, /blocks: globalThis\.XekuteContextBlocksView\?\.normalizeContextBlocks\(value\.blocks\) \|\| \[\]/);
  assert.match(bootstrap, /blocks: storedIsTier1 \? \(storedUsage\.blocks \|\| \[\]\) : \[\]/);
  assert.match(bootstrap, /renderContextBlocksHtml\(breakdown\.blocks, \{ escapeHtml, formatTokenCount \}\)/);
  assert.match(bootstrap, /window\.api\.contextPinBlock\(\{ workspace: rootPath \|\| "", memorySessionId: session\.memorySessionId \|\| "", index, pinned \}\)/);
  assert.match(bootstrap, /if \(payload\.type === "context_release"\) \{\s+applyContextReleaseUi\(run, payload\);/);
  assert.match(read("src/app/electron/preload.js"), /contextPinBlock: \(payload = \{\}\) => ipcRenderer\.invoke\("context:pinBlock", payload\)/);
  const main = read("src/app/electron/main.js");
  assert.match(main, /ipcMain\.handle\("context:pinBlock"/);
  assert.match(main, /coordinator\.pinBlock\(identity\.projectId, sessionId, index, payload\.pinned !== false\)/);
  assert.match(read("src/ui/styles/base.css"), /\.context-block-row\.released \{\s+opacity: 0\.45;/);
});
