"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const ContextBudget = require("../src/agent/runtime/context-budget.js");
const { markup, script } = require("./helpers/model-picker-harness.js");

function fixture() {
  const dom = new JSDOM(markup, { url: "http://localhost" });
  const context = { document: dom.window.document, window: dom.window, localStorage: dom.window.localStorage, ContextBudget,
    requestAnimationFrame: callback => callback() };
  vm.createContext(context); vm.runInContext(script, context);
  const el = id => dom.window.document.getElementById(id);
  return { context, el, document: dom.window.document, tick: () => new Promise(resolve => setImmediate(resolve)) };
}

test("clicking the model opens Context, Effort and current model before the browser", async () => {
  const { el, tick } = fixture();
  el("model-picker").click();
  await tick();
  assert.equal(el("model-controls-menu").hidden, false);
  assert.equal(el("model-menu").hidden, true);
  assert.equal(el("model-edit-menu").hidden, true);
  assert.equal(el("model-context-value").textContent, "262K");
  assert.equal(el("model-effort-value").textContent, "High");
  assert.equal(el("model-current-name").textContent, "reasoner");
  assert.equal(el("model-picker").getAttribute("aria-expanded"), "true");
});

test("context and effort open independent panels and preserve selections in model settings", async () => {
  const { context, el, tick } = fixture();
  el("model-picker").click(); el("model-context-trigger").click(); await tick();
  assert.equal(el("model-edit-menu").dataset.panel, "context");
  assert.equal(el("model-menu").hidden, true);
  assert.equal(context.document.activeElement.textContent, "262K");
  const choice = [...el("context-options").querySelectorAll("button")].find(button => button.textContent === "128K");
  choice.click();
  assert.equal(el("model-edit-menu").hidden, true);
  assert.equal(el("model-controls-menu").hidden, false);
  assert.equal(el("model-context-value").textContent, "128K");
  assert.equal(context.getModelSettings("acme/reasoner").contextLimitTokens, 131072);
  el("model-effort-trigger").click(); await tick();
  assert.equal(el("model-edit-menu").dataset.panel, "effort");
  assert.equal(context.document.activeElement.textContent, "High");
  const max = [...el("reasoning-options").querySelectorAll("button")].find(button => button.textContent === "Max");
  max.click();
  assert.equal(el("model-effort-value").textContent, "Max");
  assert.equal(context.getModelSettings("acme/reasoner").reasoningEffort, "max");
  assert.equal(el("model-edit-menu").hidden, true);
  assert.equal(JSON.parse(context.localStorage.getItem("models"))["openrouter:acme/reasoner"].reasoningEffort, "max");
});

test("the model row opens searchable enabled models and Add Models still opens settings", async () => {
  const { context, el, tick } = fixture();
  el("model-picker").click(); el("model-browse-trigger").click(); await tick();
  assert.equal(el("model-menu").hidden, false);
  assert.equal(el("model-edit-menu").hidden, true);
  assert.equal(el("model-list").querySelectorAll(".model-item").length, 3);
  assert.equal(el("model-list").querySelector(".model-edit-btn"), null);
  el("model-search").value = "fast";
  el("model-search").dispatchEvent(new context.window.Event("input", { bubbles: true }));
  assert.equal(el("model-list").querySelectorAll(".model-item").length, 1);
  el("model-list").querySelector("button").click(); await tick();
  assert.equal(context.selectedModel, "acme/fast");
  assert.equal(el("model-controls-menu").hidden, true);
  el("model-picker").click(); await tick();
  assert.equal(el("model-current-name").textContent, "fast");
  assert.equal(el("model-context-value").textContent, "128K");
  assert.equal(el("model-effort-trigger").disabled, true);
  el("model-browse-trigger").click(); await tick(); el("model-add-btn").click();
  assert.equal(context.settingsOpened, "llm");
  assert.equal(el("model-controls-menu").hidden, true);
});

test("a delayed model metadata response cannot reopen a dismissed submenu", async () => {
  const { context, el, tick } = fixture();
  let resolve;
  context.ensureOpenRouterModelContext = () => new Promise(done => { resolve = done; });
  el("model-picker").click(); el("model-context-trigger").click();
  el("outside").click();
  resolve(context.openRouterModelMeta["acme/reasoner"]); await tick();
  assert.equal(el("model-controls-menu").hidden, true);
  assert.equal(el("model-edit-menu").hidden, true);
});

test("switching panels while metadata is loading leaves only the last requested panel active", async () => {
  const { context, el, tick } = fixture();
  const pending = [];
  context.ensureOpenRouterModelContext = () => new Promise(resolve => pending.push(resolve));
  el("model-picker").click(); el("model-context-trigger").click(); el("model-effort-trigger").click();
  pending[1](context.openRouterModelMeta["acme/reasoner"]); await tick();
  pending[0](context.openRouterModelMeta["acme/reasoner"]); await tick();
  assert.equal(el("model-edit-menu").dataset.panel, "effort");
  assert.equal(el("model-effort-trigger").getAttribute("aria-expanded"), "true");
  assert.equal(el("model-context-trigger").getAttribute("aria-expanded"), "false");
});

test("Ollama retains its thinking toggle and separate context choices", async () => {
  const { context, el, tick } = fixture();
  context.activeLlmProvider = "ollama";
  el("model-picker").click(); el("model-effort-trigger").click(); await tick();
  assert.equal(el("ollama-thinking-section").hidden, false);
  assert.equal(el("openrouter-reasoning-row").hidden, true);
  el("thinking-toggle").click();
  assert.equal(el("model-effort-value").textContent, "Off");
  assert.equal(context.getModelSettings("acme/reasoner").thinking, false);
  el("model-context-trigger").click(); await tick();
  assert.ok(el("context-options").querySelectorAll("button").length > 1);
});

test("Escape closes one popup at a time and clicking outside dismisses the whole picker", async () => {
  const { context, el, document, tick } = fixture();
  el("model-picker").click(); el("model-context-trigger").click(); await tick();
  document.dispatchEvent(new context.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(el("model-edit-menu").hidden, true);
  assert.equal(el("model-controls-menu").hidden, false);
  document.dispatchEvent(new context.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(el("model-controls-menu").hidden, true);
  el("model-picker").click(); el("model-browse-trigger").click(); await tick();
  el("outside").click();
  assert.equal(el("model-controls-menu").hidden, true);
  assert.equal(el("model-menu").hidden, true);
});

test("unknown or empty model catalogs still allow opening the browser and adding a model", async () => {
  const { context, el, tick } = fixture();
  context.selectedModel = "";
  context.allModels = [];
  el("model-picker").click();
  assert.equal(el("model-context-trigger").disabled, true);
  assert.equal(el("model-effort-trigger").disabled, true);
  assert.equal(el("model-current-name").textContent, "Select model");
  el("model-browse-trigger").click(); await tick();
  assert.equal(el("model-menu").hidden, false);
  assert.equal(el("model-list").textContent, "No models found");
  el("model-add-btn").click();
  assert.equal(context.settingsOpened, "llm");
});

test("submenus flip toward available space and stay within a narrow viewport", () => {
  const { context, el } = fixture();
  Object.defineProperty(context.window, "innerWidth", { value: 320 });
  Object.defineProperty(context.window, "innerHeight", { value: 640 });
  el("model-controls-menu").getBoundingClientRect = () => ({ left: 82, right: 312, top: 520, bottom: 620 });
  el("model-context-trigger").getBoundingClientRect = () => ({ left: 82, right: 312, top: 520, bottom: 549 });
  Object.defineProperty(el("model-edit-menu"), "offsetWidth", { value: 230 });
  Object.defineProperty(el("model-edit-menu"), "offsetHeight", { value: 210 });
  context.positionModelEditMenu(el("model-context-trigger"));
  assert.equal(el("model-edit-menu").style.left, "8px");
  assert.equal(el("model-edit-menu").style.top, "422px");
});
