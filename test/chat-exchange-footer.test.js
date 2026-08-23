const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const bootstrapSource = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");

function functionBody(name, nextName) {
  const pattern = new RegExp(`function ${name}\\([^]*?\\r?\\n}\\r?\\n\\r?\\nfunction ${nextName}\\(`);
  const match = bootstrapSource.match(pattern);
  assert.ok(match, `Could not find ${name}`);
  return match[0];
}

function sourceBetween(startMarker, endMarker) {
  const start = bootstrapSource.indexOf(startMarker);
  const end = bootstrapSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Could not find ${startMarker}`);
  assert.ok(end > start, `Could not find ${endMarker} after ${startMarker}`);
  return bootstrapSource.slice(start, end);
}

test("assistant exchange footer is rebuilt only after the entire AI chunk is idle", () => {
  const body = functionBody("attachAssistantCopyButton", "toolIconClass");
  const removeAt = body.indexOf('querySelector(".assistant-reply-footer")?.remove()');
  const busyCheckAt = body.indexOf('getAttribute("aria-busy") === "true"');
  const appendAt = body.lastIndexOf("exchange.appendChild(footer)");

  assert.ok(removeAt >= 0, "an old or misplaced footer must be removed first");
  assert.ok(busyCheckAt > removeAt, "the whole exchange must be checked after stale metadata is removed");
  assert.ok(appendAt > busyCheckAt, "the footer must be appended only after the exchange is idle");
  assert.doesNotMatch(body, /querySelector\("\.assistant-reply-copy"\)\) return/);
});

test("starting an assistant continuation clears prior exchange metadata", () => {
  const body = sourceBetween("function createAssistantTurn(", "const BUILTIN_SLASH_COMMANDS");
  const appendTurnAt = body.indexOf("appendChatTurn(turn, { container })");
  const removeFooterAt = body.indexOf('querySelector(".assistant-reply-footer")?.remove()');

  assert.ok(appendTurnAt >= 0);
  assert.ok(removeFooterAt > appendTurnAt, "continuation metadata must be cleared as soon as its turn joins the exchange");
});

test("assistant finalization settles the live run before adding exchange metadata", () => {
  const finalizeMatch = bootstrapSource.match(/finalizeContent\(\) \{[^]*?\r?\n    },\r?\n    pruneIfEmpty\(\)/);
  assert.ok(finalizeMatch, "Could not find assistant finalizeContent");
  const body = finalizeMatch[0];
  const settleAt = body.indexOf("this.finishLiveState");
  const attachAt = body.indexOf("attachAssistantCopyButton(copyAnchor)");

  assert.ok(settleAt >= 0);
  assert.ok(attachAt > settleAt, "timestamp and copy controls must be attached after the AI run stops");
});

test("restored exchanges attach metadata after text and tool-only assistant turns", () => {
  const body = sourceBetween("function renderCanonicalChatHistory(history = [])", "function hydrateSubagentRunCards");
  const renderAllAt = body.indexOf("for (const message of sourceHistory) renderMessage(message, fragment)");
  const exchangePassAt = body.indexOf('fragment.querySelectorAll(".chat-exchange")');
  const attachAt = body.indexOf("attachAssistantCopyButton(copyAnchor)", exchangePassAt);
  const replaceAt = body.indexOf("messages.replaceChildren(fragment)");

  assert.ok(renderAllAt >= 0);
  assert.ok(exchangePassAt > renderAllAt, "the complete restored exchange must render before metadata placement");
  assert.ok(attachAt > exchangePassAt);
  assert.ok(replaceAt > attachAt, "the finalized exchange should enter the visible transcript with its footer last");
});
