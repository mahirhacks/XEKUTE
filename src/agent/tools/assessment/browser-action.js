"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");
const { schemas } = require("../../../contracts/browser/browser-contracts.js");
const Ajv = require("ajv");
const ACTIONS = ["navigate", "click", "double_click", "move", "hover", "type", "select", "insert_text", "press_key", "scroll", "drag", "wait", "extract", "open_page", "list_pages", "close_page", "observe", "screenshot", "back", "forward", "reload", "handle_dialog", "upload", "download"];
const targetSchema = schemas.action.oneOf.find(item => item.properties.action.const === "click").properties.target;

const BROWSER_ACTION_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["action"],
  properties: {
    action: { type: "string", enum: ACTIONS },
    tabId: { type: "string", minLength: 1, maxLength: 160 },
    purpose: { enum: ["assessment", "research"] },
    target: targetSchema,
    from: targetSchema,
    to: targetSchema,
    key: { type: "string", minLength: 1, maxLength: 100 },
    deltaX: { type: "number" },
    deltaY: { type: "number" },
    accept: { type: "boolean" },
    paths: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 4000 } },
    downloadId: { type: "string", minLength: 1, maxLength: 160 },
    identityId: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    pageId: { type: "string" },
    url: { type: "string" },
    selector: { type: "string" },
    text: { type: "string" },
    option: { type: "string" },
    value: { type: "string" },
    waitMs: { type: "integer", minimum: 0, maximum: 120000 },
    timeoutMs: { type: "integer", minimum: 100, maximum: 120000 },
    extract: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["title", "text", "html", "url", "attribute", "all"] },
        attribute: { type: "string" },
        selector: { type: "string" },
      },
    },
    type: { type: "string", enum: ["title", "text", "html", "url", "attribute", "all"] },
    attribute: { type: "string", minLength: 1, maxLength: 100 },
  },
  allOf: [{
    if: { properties: { action: { enum: ["click", "double_click", "move", "hover", "type", "select", "upload", "scroll"] } }, required: ["action"] },
    then: { not: { required: ["target", "selector"] } },
  }],
});
let ajv = null;
let validateShape = null;

const BROWSER_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_BROWSER_ACTION_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  PROVIDER_UNAVAILABLE: "BROWSER_PROVIDER_UNAVAILABLE",
  PROVIDER_ERROR: "BROWSER_ACTION_FAILED",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: BROWSER_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  ajv ||= new Ajv({ strict: false });
  validateShape ||= ajv.compile(BROWSER_ACTION_INPUT_SCHEMA);
  if (!validateShape(input)) return invalidInput("Invalid browser action fields: " + ajv.errorsText(validateShape.errors));
  if (input.identityId !== undefined && input.identityId !== null && (typeof input.identityId !== "string" || input.identityId.trim() === "")) {
    return invalidInput("identityId must be a non-empty string when provided");
  }
  if (input.pageId !== undefined && (typeof input.pageId !== "string" || input.pageId.trim() === "" || input.pageId.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input.pageId))) {
    return invalidInput("pageId must contain only letters, numbers, dots, underscores, or hyphens");
  }
  if (["navigate", "open_page"].includes(input.action) && input.action === "navigate" && (typeof input.url !== "string" || input.url.trim() === "")) {
    return invalidInput("navigate requires a non-empty url");
  }
  if (["navigate", "open_page"].includes(input.action) && input.url) {
    try {
      const parsed = new URL(input.url);
      if (!["http:", "https:"].includes(parsed.protocol) && input.url !== "about:blank") return invalidInput("url must use http or https");
    } catch {
      return invalidInput("url must be a valid absolute URL");
    }
  }
  if (["click", "double_click", "move", "hover", "type", "select", "upload"].includes(input.action) && !input.target && (typeof input.selector !== "string" || input.selector.trim() === "")) {
    return invalidInput(`${input.action} requires an element, selector, or screenshot point target`);
  }
  if (input.action === "extract") {
    const extractType = input.extract?.type || input.type || "text";
    // Whole-document text, HTML, and aggregate extraction use the provider's
    // body/document defaults. Only an attribute lookup has no document-level fallback.
    const needsSelector = extractType === "attribute";
    const selector = input.extract?.selector || input.selector;
    if (needsSelector && (typeof selector !== "string" || selector.trim() === "")) {
      return invalidInput("extract requires a non-empty selector");
    }
    // All other extraction types may omit a selector; the provider defaults to
    // the page or body as appropriate.
    if (typeof input.selector !== "string" && input.selector !== undefined) return invalidInput("selector must be a string");
  }
  if (["type", "insert_text"].includes(input.action) && typeof input.text !== "string") return invalidInput(`${input.action} requires a text string`);
  if (input.action === "select" && typeof input.option !== "string" && typeof input.text !== "string") return invalidInput("select requires a text or option string");
  if (input.action === "press_key" && !input.key) return invalidInput("press_key requires a key");
  if (input.action === "scroll" && (typeof input.deltaX !== "number" || typeof input.deltaY !== "number")) return invalidInput("scroll requires deltaX and deltaY");
  if (input.action === "drag" && (!input.from || !input.to)) return invalidInput("drag requires from and to targets");
  if (input.action === "handle_dialog" && typeof input.accept !== "boolean") return invalidInput("handle_dialog requires accept");
  if (input.action === "upload" && !input.paths?.length) return invalidInput("upload requires paths");
  if (input.action === "download" && !input.downloadId) return invalidInput("download requires downloadId");
  if (input.action === "wait" && input.waitMs !== undefined && (!Number.isInteger(input.waitMs) || input.waitMs < 0 || input.waitMs > 120000)) {
    return invalidInput("waitMs must be an integer between 0 and 120000");
  }
  if (input.extract !== undefined && !isRecord(input.extract)) return invalidInput("extract must be an object");
  return { ok: true };
}

function createBrowserActionTool({ browserProvider = null } = {}) {
  const adapter = {
    name: "browser_action",
    description: "Control the shared workspace browser. list_pages finds project tabs and their owners. open_page creates a tab; existing human tabs require the user to hand control to this chat. Use observe and its tabId, observationId and element refs first. Refresh once after a stale observation. For canvas or visually ambiguous targets use screenshot, then point targets in screenshot pixel coordinates; return to observe after acting. Screenshots require the selected OpenRouter model to support images and tools. Assessment tabs follow the project scope: related subdomains are read-only until the user approves, a page that drifted off scope asks the user first, and excluded or unrelated sites are denied. A result scope note says how the current page stands. Never reopen a denied assessment target as research, and never use screenshot or retries to bypass ownership denial, takeover, cancellation, approval or policy errors. Actions stay in the existing agent loop and can be stopped or steered between calls.",
    inputSchema: BROWSER_ACTION_INPUT_SCHEMA,
    async execute(input, executionContext, runtime = {}) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(BROWSER_ERROR_CODES.INVALID_CONTEXT, "browser_action requires a restricted tool execution context projection");
      }
      if (!browserProvider || typeof browserProvider.execute !== "function") {
        return structuredFailure(BROWSER_ERROR_CODES.PROVIDER_UNAVAILABLE, "no browser provider is configured; wire one at composition");
      }

      try {
        const evidence = await browserProvider.execute(input, executionContext, runtime);
        if (evidence?.ok === false) return evidence;
        return {
          ok: true,
          value: {
            action: input.action,
            evidence,
          },
        };
      } catch (error) {
        return structuredFailure(error.code || BROWSER_ERROR_CODES.PROVIDER_ERROR, error.message);
      }
    },
  };

  return adapter;
}

module.exports = {
  BROWSER_ACTION_INPUT_SCHEMA,
  BROWSER_ERROR_CODES,
  createBrowserActionTool,
  validateInput,
};
