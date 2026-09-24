"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("chat history splits today from the previous 7 days", async () => {
  const { groupHistoryByAge } = await import("../src/ui/features/history/history-model.js");
  const now = new Date(2026, 8, 23, 15, 0, 0);
  const at = (day, hour = 12) => new Date(2026, 8, day, hour, 0, 0).toISOString();
  const groups = groupHistoryByAge([
    { id: "today", updatedAt: at(23, 9), messagesHtml: "x" },
    { id: "yesterday", updatedAt: at(22), messagesHtml: "x" },
    { id: "week", updatedAt: at(17), messagesHtml: "x" },
    { id: "older", updatedAt: at(10), messagesHtml: "x" },
  ], now);
  const byId = Object.fromEntries(groups.map((group) => [group.id, group.sessions.map((session) => session.id)]));
  assert.deepEqual(byId.today, ["today"]);
  assert.deepEqual(byId.previous, ["yesterday", "week"]);
  assert.deepEqual(byId.older, ["older"]);
  assert.equal(groups.find((group) => group.id === "today").label, "Today");
  assert.equal(groups.find((group) => group.id === "previous").label, "Previous 7 days");
});
