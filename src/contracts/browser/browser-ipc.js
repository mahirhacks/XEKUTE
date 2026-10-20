"use strict";

const path = require("node:path");
const Ajv = require("ajv");

const text = { type: "string", minLength: 1, maxLength: 32768 };
const id = { type: "string", minLength: 1, maxLength: 240 };
const generation = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const project = { assessmentPath: text };
const object = (properties, required) => ({ type: "object", additionalProperties: false, properties, required });
const schemas = {
  "browser:open": object({ ...project, purpose: { enum: ["assessment", "research"] }, identityId: { anyOf: [id, { type: "null" }] }, url: text, sessionId: { anyOf: [id, { type: "null" }] } }, ["assessmentPath", "purpose"]),
  "browser:list": object(project, ["assessmentPath"]),
  "browser:command": { oneOf: [
    object({ ...project, tabId: id, command: { const: "navigate" }, url: text }, ["assessmentPath", "tabId", "command", "url"]),
    object({ ...project, tabId: id, command: { enum: ["back", "forward", "reload", "close"] } }, ["assessmentPath", "tabId", "command"]),
    object({ ...project, tabId: id, command: { const: "handoff" }, sessionId: id, expectedGeneration: generation }, ["assessmentPath", "tabId", "command", "sessionId", "expectedGeneration"]),
    object({ ...project, tabId: id, command: { const: "takeover" }, expectedGeneration: generation }, ["assessmentPath", "tabId", "command", "expectedGeneration"]),
  ] },
  "browser:layout": object({ ...project, tabId: id, visible: { type: "boolean" }, bounds: object({
    x: { type: "integer", minimum: 0, maximum: 100000 }, y: { type: "integer", minimum: 0, maximum: 100000 },
    width: { type: "integer", minimum: 1, maximum: 100000 }, height: { type: "integer", minimum: 1, maximum: 100000 },
  }, ["x", "y", "width", "height"]) }, ["assessmentPath", "tabId", "bounds", "visible"]),
  "browser:hide": object({}, []),
  "browser:capture": object({ ...project, tabId: id }, ["assessmentPath", "tabId"]),
};
let ajv = null;
const validators = new Map();

function validateBrowserIpcRequest(channel, args) {
  if (!Object.hasOwn(schemas, channel)) return null;
  ajv ||= new Ajv({ allErrors: false, strict: false });
  if (!validators.has(channel)) validators.set(channel, ajv.compile(schemas[channel]));
  const validate = validators.get(channel);
  if (args.length !== 1 || !validate(args[0])) return { code: "INVALID_IPC_PAYLOAD", message: "Invalid browser request." };
  const payload = args[0];
  if (payload.assessmentPath && !path.isAbsolute(payload.assessmentPath)) return { code: "INVALID_IPC_PAYLOAD", message: "Browser projects require an absolute workspace path." };
  if (payload.purpose === "research" && payload.identityId) return { code: "INVALID_IPC_PAYLOAD", message: "Research tabs cannot use assessment identities." };
  if (payload.url) {
    try { const url = new URL(payload.url); if (!["http:", "https:"].includes(url.protocol) && payload.url !== "about:blank") throw new Error(); }
    catch { return { code: "INVALID_IPC_PAYLOAD", message: "Browser URLs must use HTTP or HTTPS." }; }
  }
  return null;
}

module.exports = { validateBrowserIpcRequest, channels: Object.freeze(Object.keys(schemas)) };
