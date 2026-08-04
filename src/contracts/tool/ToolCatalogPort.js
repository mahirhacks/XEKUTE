"use strict";

/**
 * ToolCatalogPort
 *
 * Dependency-free contract for tool schema/metadata access and mode filtering.
 * It intentionally does NOT own handler execution; that is ToolExecutionPort's
 * responsibility. Keeping the catalog separate from execution is what lets
 * application orchestration consume a replaceable tool surface without coupling
 * to a concrete adapter.
 */

const ToolCatalogPort = Object.freeze({
  getSchema(name) { return undefined; },
  toolsForProfile(profile) { return []; },
  toolNamesForProfile(profile) { return []; },
  loadSchemas(request) { return { ok: false, loaded: [], denied: [], missing: [], unknownPacks: [], schemas: [] }; },
  normalizeCall(call) { return { ok: false }; },
  validateCall(call, args) { return { ok: false }; },
});

module.exports = ToolCatalogPort;
