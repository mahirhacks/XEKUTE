"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { rendererDefinitions } = require("./helpers/renderer-source.js");
const { readUiShell } = require("./helpers/ui-shell.js");

const mainSource = fs.readFileSync(path.join(__dirname, "../src/app/electron/main.js"), "utf8");
const start = mainSource.indexOf("async function listOpenRouterDecisionModels()");
const end = mainSource.indexOf("function parseOpenRouterModelSlug(", start);
assert.ok(start >= 0 && end > start);

function catalogLoader(openRouterFetch) {
  const context = vm.createContext({ openRouterFetch });
  vm.runInContext(mainSource.slice(start, end), context);
  return context.listOpenRouterDecisionModels;
}

function dropdown(api) {
  const dom = new JSDOM('<select id="agent-decision-model"></select>');
  const select = dom.window.document.querySelector("select");
  const context = vm.createContext({
    document: dom.window.document,
    window: { api },
    decisionModelSelect: select,
  });
  vm.runInContext(rendererDefinitions("DEFAULT_DECISION_MODEL", "loadDecisionModelOptions"), context);
  return { dom, select, load: context.loadDecisionModelOptions };
}

test("decision catalog requests the decision modality and populates the real settings dropdown", async (t) => {
  const paths = [];
  const loadCatalog = catalogLoader(async (pathname) => {
    paths.push(pathname);
    return { ok: true, json: async () => ({ data: [
      { id: "typesafe/jev-1.14", name: "TypeSafe: Jev 1.14", architecture: { output_modalities: ["decisions"] } },
      { id: "cloudflare/clef", name: "Cloudflare: Clef", architecture: { output_modalities: ["decisions"] } },
      { id: "chat/model", architecture: { output_modalities: ["text"] } },
      { id: "unavailable/model", available: false, architecture: { output_modalities: ["decisions"] } },
    ] }) };
  });
  const ui = dropdown({ openRouterDecisionModels: loadCatalog });
  t.after(() => ui.dom.window.close());
  await ui.load("typesafe/jev-1.14");
  assert.deepEqual(paths, ["/models?output_modalities=decisions"]);
  assert.deepEqual(Array.from(ui.select.options, (option) => [option.value, option.textContent]), [
    ["cloudflare/clef", "Cloudflare: Clef"],
    ["typesafe/jev-1.14", "TypeSafe: Jev 1.14"],
  ]);
  assert.equal(ui.select.value, "typesafe/jev-1.14");
});

test("decision dropdown preserves a saved model on empty, failed, or changed catalogs", async (t) => {
  for (const response of [
    async () => ({ models: [] }),
    async () => ({ error: "Catalog unavailable" }),
    async () => { throw new Error("IPC unavailable"); },
    async () => ({ models: [{ id: "other/model", name: "Other" }] }),
  ]) {
    const ui = dropdown({ openRouterDecisionModels: response });
    t.after(() => ui.dom.window.close());
    await ui.load("saved/model");
    assert.equal(ui.select.value, "saved/model");
    assert.ok(Array.from(ui.select.options).some((option) => option.value === "saved/model"));
  }
});

test("Agent settings shows only the Decision model label and its dropdown", (t) => {
  const dom = new JSDOM(readUiShell());
  t.after(() => dom.window.close());
  const select = dom.window.document.querySelector("#agent-decision-model");
  const section = select.closest("section");
  assert.equal(section.querySelector("h2").textContent, "Decision model");
  assert.equal(section.querySelector("p"), null);
  assert.equal(section.children.length, 2);
  assert.equal(select.getAttribute("aria-label"), "Decision model");
});
