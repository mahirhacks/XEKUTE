"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const BROWSER_ACTION_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["navigate", "click", "type", "select", "wait", "extract", "open_page", "list_pages", "close_page"] },
    identityId: { type: "string" },
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
  },
});

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
  if (!["navigate", "click", "type", "select", "wait", "extract", "open_page", "list_pages", "close_page"].includes(input.action)) {
    return invalidInput("action must be navigate, click, type, select, wait, extract, open_page, list_pages, or close_page");
  }
  if (input.identityId !== undefined && (typeof input.identityId !== "string" || input.identityId.trim() === "")) {
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
      if (!["http:", "https:"].includes(parsed.protocol)) return invalidInput("url must use http or https");
    } catch {
      return invalidInput("url must be a valid absolute URL");
    }
  }
  if (["click", "type", "select"].includes(input.action) && (typeof input.selector !== "string" || input.selector.trim() === "")) {
    return invalidInput(`${input.action} requires a non-empty selector`);
  }
  if (input.action === "extract") {
    const extractType = input.extract?.type || "text";
    // Whole-document text, HTML, and aggregate extraction use the provider's
    // body/document defaults. Only an attribute lookup has no document-level fallback.
    const needsSelector = extractType === "attribute";
    if (needsSelector && (typeof input.selector !== "string" || input.selector.trim() === "")) {
      return invalidInput("extract requires a non-empty selector");
    }
    // All other extraction types may omit a selector; the provider defaults to
    // the page or body as appropriate.
    if (typeof input.selector !== "string" && input.selector !== undefined) return invalidInput("selector must be a string");
  }
  if (input.action === "type" && typeof input.text !== "string") return invalidInput("type requires a text string");
  if (input.action === "select" && typeof input.option !== "string") return invalidInput("select requires an option string");
  if (input.action === "wait" && input.waitMs !== undefined && (!Number.isInteger(input.waitMs) || input.waitMs < 0 || input.waitMs > 120000)) {
    return invalidInput("waitMs must be an integer between 0 and 120000");
  }
  if (input.extract !== undefined && !isRecord(input.extract)) return invalidInput("extract must be an object");
  return { ok: true };
}

function createBrowserActionTool({ browserProvider = null } = {}) {
  const adapter = {
    name: "browser_action",
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
