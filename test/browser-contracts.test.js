"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateBrowserContract, validateBrowserActionBinding, createBrowserTab, transitionBrowserTab } = require("../src/contracts/browser/browser-contracts.js");

const tab = () => createBrowserTab({ id: "tab_one", projectId: "project_one", purpose: "assessment", identityId: null });

test("browser actions accept one target representation and no forged execution context", () => {
  for (const target of [
    { kind: "element", observationId: "observation_one", ref: "e1" },
    { kind: "selector", selector: "button[type=submit]" },
    { kind: "point", screenshotId: "image_one", x: 40, y: 80 },
  ]) assert.equal(validateBrowserContract("action", { action: "click", tabId: "tab_one", target }).ok, true);
  for (const value of [
    { action: "click", tabId: "tab_one" },
    { action: "click", tabId: "tab_one", target: { kind: "point", x: 2, y: 4 } },
    { action: "click", tabId: "tab_one", target: { kind: "selector", selector: "a", x: 2 } },
    { action: "click", tabId: "tab_one", target: { kind: "point", screenshotId: "image_one", x: -1, y: 4 } },
    { action: "navigate", tabId: "tab_one", url: "file:///private.txt" },
    { action: "navigate", tabId: "tab_one", url: "https://example.test", owner: { kind: "human" } },
    { action: "handoff", tabId: "tab_one", sessionId: "chat_one" },
  ]) assert.equal(validateBrowserContract("action", value).ok, false, JSON.stringify(value));
});

test("trusted UI commands are separate from browser actions", () => {
  assert.equal(validateBrowserContract("operatorCommand", { command: "handoff", tabId: "tab_one", expectedGeneration: 0, sessionId: "chat_one" }).ok, true);
  assert.equal(validateBrowserContract("operatorCommand", { command: "open", projectId: "project_one", purpose: "research", identityId: "admin" }).ok, false);
  assert.equal(validateBrowserContract("operatorCommand", { command: "open", projectId: "project_one", purpose: "research" }).ok, true);
  assert.equal(validateBrowserContract("action", { action: "open_page", purpose: "research" }).ok, true);
  assert.equal(validateBrowserContract("action", { action: "open_page", projectId: "project_one", purpose: "research" }).ok, false);
});

test("action references cannot cross tabs or reuse invalidated observations", () => {
  const current = tab();
  const observation = { id: "observation_one", tabId: current.id, documentVersion: 0, viewportRevision: 0,
    url: "https://example.test", title: "Example", text: "Sign in", truncated: false,
    frames: [{ id: "frame_one", url: "https://example.test" }], elements: [{ ref: "e1", frameId: "frame_one", role: "button", name: "Sign in" }], artifactIds: [] };
  const action = { action: "click", tabId: current.id, target: { kind: "element", observationId: observation.id, ref: "e1" } };
  assert.equal(validateBrowserActionBinding(action, { tab: current, observation }).ok, true);
  assert.equal(validateBrowserActionBinding(action, { tab: current, observation: { ...observation, tabId: "tab_other" } }).ok, false);
  assert.equal(validateBrowserActionBinding(action, { tab: { ...current, documentVersion: 1 }, observation }).ok, false);
  assert.equal(validateBrowserActionBinding(action, { tab: current, observation: { ...observation, elements: [] } }).ok, false);
});

test("browser observations and screenshots carry finite, bounded identities and dimensions", () => {
  const screenshot = { id: "image_one", artifactId: "artifact_one", tabId: "tab_one", documentVersion: 1, viewportRevision: 2,
    mimeType: "image/png", pixelWidth: 1200, pixelHeight: 800, viewportWidth: 600, viewportHeight: 400,
    scrollX: 0, scrollY: 12, deviceScaleFactor: 2, zoomFactor: 1 };
  assert.equal(validateBrowserContract("screenshot", screenshot).ok, true);
  for (const change of [{ pixelWidth: 0 }, { zoomFactor: 0 }, { scrollY: Infinity }, { viewportRevision: -1 }, { mimeType: "text/plain" }]) {
    assert.equal(validateBrowserContract("screenshot", { ...screenshot, ...change }).ok, false);
  }
  const observation = { id: "observation_one", tabId: "tab_one", documentVersion: 1, viewportRevision: 2,
    url: "https://example.test/", title: "Fixture", text: "Sign in", truncated: false,
    frames: [{ id: "frame_one", url: "https://example.test/" }], elements: [{ ref: "e1", frameId: "frame_one", role: "button", name: "Sign in" }], artifactIds: [] };
  assert.equal(validateBrowserContract("observation", observation).ok, true);
  assert.equal(validateBrowserContract("observation", { ...observation, text: "x".repeat(24001) }).ok, false);
});

test("repeated-label observations accept bounded row context and remain usable targets", () => {
  const current = tab();
  const observation = { id: "obs", tabId: current.id, documentVersion: 0, viewportRevision: 0, url: "about:blank", title: "", text: "Delete Alpha", truncated: false,
    frames: [{ id: "f", url: "about:blank" }], elements: [{ ref: "e", frameId: "f", role: "button", name: "Delete", context: "Alpha report" }], artifactIds: [] };
  assert.equal(validateBrowserContract("observation", observation).ok, true);
  assert.equal(validateBrowserActionBinding({ action: "click", tabId: current.id, target: { kind: "element", observationId: "obs", ref: "e" } }, { tab: current, observation }).ok, true);
  assert.equal(validateBrowserContract("observation", { ...observation, elements: [{ ...observation.elements[0], context: "x".repeat(101) }] }).ok, false);
});

test("handoff invalidates old generations and does not mutate prior state", () => {
  const original = tab();
  const assigned = transitionBrowserTab(original, { type: "handoff", expectedGeneration: 0, sessionId: "chat_one" });
  assert.equal(assigned.ok, true);
  assert.deepEqual(assigned.value.owner, { kind: "chat", sessionId: "chat_one" });
  assert.equal(assigned.value.controlGeneration, 1);
  assert.equal(original.owner.kind, "human");
  assert.equal(transitionBrowserTab(assigned.value, { type: "takeover", expectedGeneration: 0 }).error.code, "BROWSER_CONTROL_STALE");
  assert.equal(transitionBrowserTab(original, { type: "navigate", purpose: "research" }).ok, false);
});

test("takeover waits for the current operation to settle before transferring ownership", () => {
  let current = transitionBrowserTab(tab(), { type: "handoff", expectedGeneration: 0, sessionId: "chat_one" }).value;
  current = transitionBrowserTab(current, { type: "operation_started", expectedGeneration: 1, operationId: "operation_one" }).value;
  assert.equal(transitionBrowserTab(current, { type: "handoff", expectedGeneration: 1, sessionId: "chat_two" }).value.operation.status, "stopping");
  current = transitionBrowserTab(current, { type: "takeover", expectedGeneration: 1 }).value;
  assert.deepEqual(current.owner, { kind: "chat", sessionId: "chat_one" });
  assert.equal(current.operation.status, "stopping");
  assert.equal(current.controlGeneration, 2);
  assert.equal(transitionBrowserTab(current, { type: "operation_started", expectedGeneration: 2, operationId: "operation_two" }).ok, false);
  assert.equal(transitionBrowserTab(current, { type: "operation_settled", operationId: "wrong" }).ok, false);
  current = transitionBrowserTab(current, { type: "operation_settled", operationId: "operation_one" }).value;
  assert.deepEqual(current.owner, { kind: "human" });
  assert.deepEqual(current.operation, { status: "idle" });
});

test("uncertain operations require explicit recovery and closed tabs cannot start work", () => {
  let current = transitionBrowserTab(tab(), { type: "handoff", expectedGeneration: 0, sessionId: "chat_one" }).value;
  current = transitionBrowserTab(current, { type: "operation_started", expectedGeneration: 1, operationId: "operation_one" }).value;
  current = transitionBrowserTab(current, { type: "operation_uncertain", operationId: "operation_one" }).value;
  assert.equal(current.operation.status, "recovery_required");
  assert.equal(transitionBrowserTab(current, { type: "takeover", expectedGeneration: 2 }).ok, false);
  current = transitionBrowserTab(current, { type: "recovered" }).value;
  assert.equal(current.owner.kind, "human");
  current = transitionBrowserTab(current, { type: "closed" }).value;
  assert.equal(transitionBrowserTab(current, { type: "handoff", expectedGeneration: current.controlGeneration, sessionId: "chat_one" }).ok, false);
});

test("tab descriptors reject impossible ownership and operation states", () => {
  const current = tab();
  assert.equal(validateBrowserContract("tab", { ...current, operation: { status: "running", operationId: "operation_one" } }).ok, false);
  assert.equal(validateBrowserContract("tab", { ...current, status: "closed", owner: { kind: "chat", sessionId: "chat_one" } }).ok, false);
  assert.equal(validateBrowserContract("tab", { ...current, purpose: "research", identityId: "admin" }).ok, false);
});

test("screenshot bindings reject points outside the recorded image", () => {
  const current = tab();
  const screenshot = { id: "image_one", artifactId: "artifact_one", tabId: current.id, documentVersion: 0, viewportRevision: 0,
    mimeType: "image/png", pixelWidth: 1200, pixelHeight: 800, viewportWidth: 600, viewportHeight: 400,
    scrollX: 0, scrollY: 0, deviceScaleFactor: 2, zoomFactor: 1 };
  const action = { action: "click", tabId: current.id, target: { kind: "point", screenshotId: screenshot.id, x: 1199, y: 799 } };
  assert.equal(validateBrowserActionBinding(action, { tab: current, screenshot }).ok, true);
  assert.equal(validateBrowserActionBinding({ ...action, target: { ...action.target, x: 1200 } }, { tab: current, screenshot }).ok, false);
  assert.equal(validateBrowserActionBinding(action, { tab: { ...current, viewportRevision: 1 }, screenshot }).ok, false);
});
