"use strict";

const Ajv = require("ajv");

const BROWSER_CONTRACT_VERSION = 1;
const ERROR_CODES = Object.freeze({
  INVALID: "BROWSER_CONTRACT_INVALID", STALE_CONTROL: "BROWSER_CONTROL_STALE", BUSY: "BROWSER_TAB_BUSY",
  UNAVAILABLE: "BROWSER_TAB_UNAVAILABLE", OPERATION_MISMATCH: "BROWSER_OPERATION_MISMATCH",
  STALE_OBSERVATION: "BROWSER_OBSERVATION_STALE", PROVIDER_UNAVAILABLE: "BROWSER_PROVIDER_UNAVAILABLE",
});
const id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$" };
const string = (maxLength = 2000) => ({ type: "string", maxLength });
const nonempty = (maxLength = 2000) => ({ ...string(maxLength), minLength: 1 });
const integer = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const dimension = { type: "integer", minimum: 1, maximum: 32768 };
const positive = { type: "number", exclusiveMinimum: 0 };
const url = { type: "string", maxLength: 8192, format: "browser-url" };
const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const array = (items, maxItems) => ({ type: "array", items, maxItems });
const variant = (key, value, properties = {}, required = Object.keys(properties)) => object({ [key]: { const: value }, ...properties }, [key, ...required]);
const owner = { oneOf: [variant("kind", "human"), variant("kind", "chat", { sessionId: id })] };
const target = { oneOf: [
  variant("kind", "element", { observationId: id, ref: id }),
  variant("kind", "selector", { selector: nonempty(4000) }),
  variant("kind", "point", { screenshotId: id, x: integer, y: integer }),
] };
const operation = { oneOf: [
  variant("status", "idle"), variant("status", "running", { operationId: id }),
  variant("status", "stopping", { operationId: id, pendingOwner: owner }),
  variant("status", "recovery_required", { operationId: id }),
] };
const purpose = { enum: ["assessment", "research"] };
const identityId = { anyOf: [id, { type: "null" }] };
const sessionShape = { oneOf: [
  { properties: { purpose: { const: "assessment" } } },
  { properties: { purpose: { const: "research" }, identityId: { type: "null" } } },
] };
const tabSchema = { ...object({
  id, projectId: id, purpose, identityId, owner, controlGeneration: integer, documentVersion: integer, viewportRevision: integer,
  url, title: string(), status: { enum: ["ready", "loading", "crashed", "closed"] }, operation,
}), ...sessionShape, allOf: [
  { if: { properties: { operation: { properties: { status: { const: "running" } } } } }, then: { properties: { owner: { properties: { kind: { const: "chat" } } } } } },
  { if: { properties: { status: { const: "closed" } } }, then: { properties: { owner: { properties: { kind: { const: "human" } } }, operation: { properties: { status: { const: "idle" } } } } } },
  { if: { properties: { status: { const: "crashed" } } }, then: { properties: { operation: { properties: { status: { enum: ["idle", "recovery_required"] } } } } } },
] };
function open(key, value, projectRequired) {
  return { ...variant(key, value, { ...(projectRequired ? { projectId: id } : {}), purpose, identityId, url }, projectRequired ? ["projectId", "purpose"] : ["purpose"]), ...sessionShape };
}
const actionVariant = (action, properties = {}, required = Object.keys(properties)) => variant("action", action, { tabId: id, ...properties }, ["tabId", ...required]);
const operatorCommand = { oneOf: [
  open("command", "open", true),
  variant("command", "handoff", { tabId: id, expectedGeneration: integer, sessionId: id }),
  variant("command", "takeover", { tabId: id, expectedGeneration: integer }),
  variant("command", "select", { tabId: id }), variant("command", "close", { tabId: id }),
] };
const action = { oneOf: [
  open("action", "open_page", false),
  variant("action", "list_pages"),
  ...["close_page", "observe", "screenshot", "back", "forward", "reload"].map(name => actionVariant(name)),
  actionVariant("navigate", { url }),
  ...["click", "double_click", "move", "hover"].map(name => actionVariant(name, { target })),
  ...["type", "select"].map(name => actionVariant(name, { target, text: string(100000) })),
  actionVariant("insert_text", { text: string(100000) }),
  actionVariant("press_key", { key: nonempty(100) }),
  actionVariant("scroll", { target, deltaX: { type: "number" }, deltaY: { type: "number" } }, ["deltaX", "deltaY"]),
  actionVariant("drag", { from: target, to: target }),
  actionVariant("wait", { waitMs: { type: "integer", minimum: 0, maximum: 120000 } }),
  actionVariant("extract", { selector: nonempty(4000), type: { enum: ["title", "text", "html", "url", "attribute"] }, attribute: nonempty(100) }, []),
  actionVariant("handle_dialog", { accept: { type: "boolean" }, text: string(10000) }, ["accept"]),
  actionVariant("upload", { target, paths: { ...array(nonempty(4000), 20), minItems: 1 } }),
  actionVariant("download", { downloadId: id }),
] };
const observation = object({
  id, tabId: id, documentVersion: integer, viewportRevision: integer, url, title: string(), text: string(24000), truncated: { type: "boolean" },
  frames: array(object({ id, url }), 100),
  elements: array(object({ ref: id, frameId: id, role: nonempty(100), name: string(1000), context: string(100) }, ["ref", "frameId", "role", "name"]), 300), artifactIds: array(id, 20),
});
const screenshot = object({
  id, artifactId: id, tabId: id, documentVersion: integer, viewportRevision: integer,
  mimeType: { enum: ["image/png", "image/jpeg", "image/webp"] }, pixelWidth: dimension, pixelHeight: dimension,
  viewportWidth: dimension, viewportHeight: dimension, scrollX: { type: "number" }, scrollY: { type: "number" }, deviceScaleFactor: positive, zoomFactor: positive,
});
const event = { oneOf: [
  variant("type", "handoff", { expectedGeneration: integer, sessionId: id }),
  variant("type", "takeover", { expectedGeneration: integer }),
  variant("type", "operation_started", { expectedGeneration: integer, operationId: id }),
  ...["operation_settled", "operation_uncertain"].map(type => variant("type", type, { operationId: id })),
  variant("type", "document_changed", { url }, []), variant("type", "viewport_changed"),
  ...["crashed", "closed", "recovered"].map(type => variant("type", type)),
] };
const errorSchema = object({ ok: { const: false }, error: object({ code: nonempty(100), message: nonempty(2000), retryable: { type: "boolean" } }) });
const schemas = Object.freeze({ tab: tabSchema, action, operatorCommand, observation, screenshot, event, error: errorSchema });
let ajv = null;
const validators = new Map();
function validatorFor(name) {
  if (!Object.hasOwn(schemas, name)) return null;
  if (!ajv) {
    ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
    ajv.addFormat("browser-url", value => {
      if (value === "about:blank") return true;
      try { const parsed = new URL(value); return ["http:", "https:"].includes(parsed.protocol) && Boolean(parsed.hostname); }
      catch { return false; }
    });
  }
  if (!validators.has(name)) validators.set(name, ajv.compile(schemas[name]));
  return validators.get(name);
}

function failure(code, message) { return { ok: false, error: { code, message, retryable: false } }; }
function validateBrowserContract(name, value) {
  const check = validatorFor(name);
  if (!check) throw new TypeError(`Unknown browser contract: ${name}`);
  if (!check(value)) return failure(ERROR_CODES.INVALID, `Invalid browser ${name}: ${ajv.errorsText(check.errors, { dataVar: name }).slice(0, 1500)}`);
  return { ok: true, value };
}
function createBrowserTab({ id, projectId, purpose, identityId = null, url = "about:blank", title = "" }) {
  const value = { id, projectId, purpose, identityId, url, title, owner: { kind: "human" }, controlGeneration: 0,
    documentVersion: 0, viewportRevision: 0, status: "ready", operation: { status: "idle" } };
  const result = validateBrowserContract("tab", value);
  if (!result.ok) throw Object.assign(new TypeError(result.error.message), { code: result.error.code });
  return value;
}
function sameOwner(left, right) { return left.kind === right.kind && left.sessionId === right.sessionId; }
function validateBrowserActionBinding(action, { tab, observation = null, screenshot = null }) {
  for (const [name, value] of [["action", action], ["tab", tab]]) {
    const check = validateBrowserContract(name, value);
    if (!check.ok) return check;
  }
  if (action.tabId !== tab.id) return failure(ERROR_CODES.STALE_OBSERVATION, "The action belongs to a different tab.");
  for (const target of [action.target, action.from, action.to].filter(Boolean)) {
    if (target.kind === "selector") continue;
    const record = target.kind === "point" ? screenshot : observation;
    const kind = target.kind === "point" ? "screenshot" : "observation";
    if (!validateBrowserContract(kind, record).ok || record.tabId !== tab.id || record.documentVersion !== tab.documentVersion
      || record.viewportRevision !== tab.viewportRevision || record.id !== (target.screenshotId || target.observationId)) {
      return failure(ERROR_CODES.STALE_OBSERVATION, "The browser observation is no longer current.");
    }
    if (target.kind === "element" && !record.elements.some(element => element.ref === target.ref && record.frames.some(frame => frame.id === element.frameId))) {
      return failure(ERROR_CODES.STALE_OBSERVATION, "The element is absent from this observation.");
    }
    if (target.kind === "point" && (target.x >= record.pixelWidth || target.y >= record.pixelHeight)) return failure(ERROR_CODES.INVALID, "The point is outside the screenshot.");
  }
  return { ok: true, value: action };
}
function transitionBrowserTab(tab, event) {
  for (const [name, value] of [["tab", tab], ["event", event]]) {
    const validation = validateBrowserContract(name, value);
    if (!validation.ok) return validation;
  }
  if (event.expectedGeneration !== undefined && event.expectedGeneration !== tab.controlGeneration) return failure(ERROR_CODES.STALE_CONTROL, "The tab control generation changed.");
  if (tab.status === "closed") return event.type === "closed" ? { ok: true, value: tab } : failure(ERROR_CODES.UNAVAILABLE, "The tab is closed.");
  const next = structuredClone(tab);
  if (["handoff", "takeover"].includes(event.type)) {
    if (next.status === "crashed" || next.operation.status === "recovery_required") return failure(ERROR_CODES.UNAVAILABLE, "Recover the tab before transferring control.");
    const owner = event.type === "takeover" ? { kind: "human" } : { kind: "chat", sessionId: event.sessionId };
    if (next.operation.status === "idle" && sameOwner(next.owner, owner)) return { ok: true, value: tab };
    if (next.operation.status === "stopping" && sameOwner(next.operation.pendingOwner, owner)) return { ok: true, value: tab };
    next.controlGeneration++;
    if (next.operation.status === "idle") next.owner = owner;
    else next.operation = { status: "stopping", operationId: next.operation.operationId, pendingOwner: owner };
  } else if (event.type === "operation_started") {
    if (next.status === "crashed" || next.operation.status !== "idle" || next.owner.kind !== "chat") return failure(ERROR_CODES.BUSY, "The tab is not ready for an agent operation.");
    next.operation = { status: "running", operationId: event.operationId };
  } else if (["operation_settled", "operation_uncertain"].includes(event.type)) {
    if (!["running", "stopping"].includes(next.operation.status) || next.operation.operationId !== event.operationId) return failure(ERROR_CODES.OPERATION_MISMATCH, "The operation is no longer current.");
    if (event.type === "operation_uncertain") {
      if (next.operation.status === "running") next.controlGeneration++;
      next.operation = { status: "recovery_required", operationId: event.operationId };
    } else {
      if (next.operation.status === "stopping") next.owner = next.operation.pendingOwner;
      next.operation = { status: "idle" };
    }
  } else if (event.type === "document_changed") {
    next.documentVersion++;
    if (event.url) next.url = event.url;
  } else if (event.type === "viewport_changed") next.viewportRevision++;
  else if (event.type === "recovered") {
    if (next.operation.status !== "recovery_required" && next.status !== "crashed") return failure(ERROR_CODES.INVALID, "The tab does not need recovery.");
    next.status = "ready"; next.operation = { status: "idle" }; next.owner = { kind: "human" };
    next.controlGeneration++; next.documentVersion++; next.viewportRevision++;
  } else {
    next.status = event.type === "closed" ? "closed" : "crashed";
    next.controlGeneration++; next.documentVersion++;
    if (next.status === "closed") { next.operation = { status: "idle" }; next.owner = { kind: "human" }; }
    else if (next.operation.status !== "idle") next.operation = { status: "recovery_required", operationId: next.operation.operationId };
  }
  return validateBrowserContract("tab", next);
}

module.exports = { BROWSER_CONTRACT_VERSION, ERROR_CODES, schemas, validateBrowserContract, validateBrowserActionBinding, createBrowserTab, transitionBrowserTab };
