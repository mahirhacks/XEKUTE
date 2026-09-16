"use strict";

const { assertToolAdapter } = require("../../../contracts/tool/tool-adapter");
const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");
const { DEFAULT_TAIL_CHARS, MAX_TAIL_CHARS } = require("../../../app/services/terminal/active-terminal-catalog.js");

const VIEW_ACTIVE_TERMINAL_INPUT_SCHEMA = Object.freeze({
  type: "object",
  description: "Inspect the terminal tab the operator is currently viewing in Xekute (user_active_terminal), or another tab from this chat. Operator-created terminals are read-only. Agent-created terminals can be read here and controlled with exec_command operation=stop.",
  additionalProperties: false,
  properties: {
    terminal_id: {
      type: "string",
      minLength: 1,
      description: "Optional terminal tab id. Omit to view the operator's focused tab, which may be null when the panel is collapsed or empty.",
    },
    tail_chars: {
      type: "integer",
      minimum: 0,
      maximum: MAX_TAIL_CHARS,
      description: `Maximum recent output characters to return. Defaults to ${DEFAULT_TAIL_CHARS}.`,
    },
  },
});

function invalidInput(message) {
  return {
    ok: false,
    error: {
      code: "INVALID_VIEW_ACTIVE_TERMINAL_INPUT",
      message,
      retryable: false,
    },
  };
}

function validateInput(input) {
  if (input == null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input)) return invalidInput("Input must be an object");
  if (input.terminal_id !== undefined && (typeof input.terminal_id !== "string" || !input.terminal_id.trim())) {
    return invalidInput("terminal_id must be a non-empty string");
  }
  if (input.tail_chars !== undefined && (!Number.isInteger(input.tail_chars) || input.tail_chars < 0 || input.tail_chars > MAX_TAIL_CHARS)) {
    return invalidInput(`tail_chars must be an integer between 0 and ${MAX_TAIL_CHARS}`);
  }
  return { ok: true, value: input };
}

function createViewActiveTerminalTool({ catalog = null } = {}) {
  const adapter = {
    name: "view_active_terminal",
    description: VIEW_ACTIVE_TERMINAL_INPUT_SCHEMA.description,
    inputSchema: VIEW_ACTIVE_TERMINAL_INPUT_SCHEMA,
    async execute(input, executionContext, runtime = {}) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return {
          ok: false,
          error: {
            code: "INVALID_EXECUTION_CONTEXT",
            message: "view_active_terminal requires a restricted tool execution context projection",
            retryable: false,
          },
        };
      }
      const resolver = runtime.catalog || catalog;
      if (!resolver || typeof resolver.view !== "function") {
        return {
          ok: false,
          error: {
            code: "ACTIVE_TERMINAL_CATALOG_UNAVAILABLE",
            message: "Active terminal tracking is unavailable in this execution environment.",
            retryable: false,
          },
        };
      }
      const args = validation.value || {};
      return resolver.view({
        ownerId: runtime.ownerId,
        chatSessionId: runtime.sessionId || executionContext.sessionId || "",
        terminalId: args.terminal_id,
        tailChars: args.tail_chars,
        workspace: executionContext.workspace?.root || "",
      });
    },
  };
  return assertToolAdapter(adapter);
}

module.exports = {
  VIEW_ACTIVE_TERMINAL_INPUT_SCHEMA,
  createViewActiveTerminalTool,
};
