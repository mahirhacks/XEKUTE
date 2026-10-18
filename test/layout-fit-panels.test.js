"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../src/ui/react/layout/fit-panels.mjs");

test("panels keep their chosen widths when the editor has room", async () => {
  const { fitPanelWidths } = await load();
  assert.deepEqual(fitPanelWidths({ available: 1235, viewportWidth: 1280, sidebar: 244, chat: 513 }), { sidebar: 244, chat: 513 });
});

test("a small window or high zoom shrinks the sidebar first, then the chat", async () => {
  const { fitPanelWidths, panelMinimums } = await load();
  // 1280 px window at 150% zoom: 853 CSS px, 808 shared after the activity bar.
  const fit = fitPanelWidths({ available: 808, viewportWidth: 853, sidebar: 244, chat: 513 });
  const min = panelMinimums(853);
  assert.equal(fit.sidebar, min.sidebar);
  assert.equal(fit.sidebar + fit.chat + min.editor, 808);
});

test("the editor only drops below its minimum once both panels are at theirs", async () => {
  const { fitPanelWidths } = await load();
  assert.deepEqual(fitPanelWidths({ available: 500, viewportWidth: 545, sidebar: 244, chat: 513 }), { sidebar: 120, chat: 220 });
});

test("the dragged panel keeps its width while the other one yields", async () => {
  const { fitPanelWidths, panelMinimums } = await load();
  const min = panelMinimums(1077);
  const fit = fitPanelWidths({ available: 1032, viewportWidth: 1077, sidebar: 244, chat: 500, keep: "chat" });
  assert.equal(fit.chat, 500);
  assert.equal(fit.sidebar, 1032 - 500 - min.editor);
  const sidebarDrag = fitPanelWidths({ available: 1032, viewportWidth: 1077, sidebar: 300, chat: 513, keep: "sidebar" });
  assert.equal(sidebarDrag.sidebar, 300);
  assert.equal(sidebarDrag.chat, 1032 - 300 - min.editor);
});

test("hidden panels take no space and narrow preferences are never widened", async () => {
  const { fitPanelWidths } = await load();
  assert.deepEqual(fitPanelWidths({ available: 600, viewportWidth: 645, sidebar: 0, chat: 513 }), { sidebar: 0, chat: 400 });
  assert.deepEqual(fitPanelWidths({ available: 400, viewportWidth: 445, sidebar: 100, chat: 0 }), { sidebar: 100, chat: 0 });
});
