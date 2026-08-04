"use strict";

/**
 * ToolPort (compat adapter) for the application layer.
 *
 * Exposes the tool catalog and error classification behind an application-owned
 * seam so application orchestration never imports concrete adapters directly.
 * The DI container (Stage 6) may replace this with an injected ToolPort; until
 * then this compat module keeps behavior identical.
 */
const ToolCatalog = require("../../adapters/tools/core/tool-catalog");
const { deriveErrorClass } = require("../../adapters/tools/core/error-class");
const { estimateTokenCount } = require("../../adapters/llm/context-budget");

module.exports = {
  ...ToolCatalog,
  deriveErrorClass,
  estimateTokenCount,
};
