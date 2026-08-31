"use strict";

const Ajv2020 = require("ajv/dist/2020.js");
const { MemoryContractError } = require("./memory-errors.js");
const { SCHEMAS, V3_SCHEMA_VERSION } = require("./v3-schemas.js");

const VALIDATOR_ERRORS = Object.freeze({
  schema: "MEMORY_SCHEMA_INVALID",
  unknownField: "MEMORY_SCHEMA_UNKNOWN_FIELD",
  size: "MEMORY_SCHEMA_SIZE_LIMIT",
});

function redactErrors(errors) {
  return (Array.isArray(errors) ? errors : []).map((error) => ({
    instancePath: String(error.instancePath || ""),
    keyword: String(error.keyword || ""),
    params: error.params && typeof error.params === "object" ? { ...error.params } : {},
    message: String(error.message || "schema validation failed"),
  }));
}

function createMemorySchemaRegistry({ ajv = null, schemas = SCHEMAS } = {}) {
  const validator = ajv || new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true, validateFormats: false });
  const compiled = new Map();
  const source = schemas && typeof schemas === "object" ? schemas : {};
  for (const [name, schema] of Object.entries(source)) {
    if (!schema || typeof schema !== "object" || !schema.$id) throw new Error(`V3 schema '${name}' is missing a stable $id.`);
    compiled.set(name, validator.compile(schema));
  }

  function resolve(name) {
    const key = String(name || "");
    const check = compiled.get(key);
    if (!check) throw new MemoryContractError("MEMORY_SCHEMA_NOT_FOUND", `Unknown V3 memory schema: ${key || "<empty>"}.`, { schema: key });
    return check;
  }

  function validate(name, value) {
    const check = resolve(name);
    const ok = Boolean(check(value));
    if (ok) return { ok: true, value };
    const errors = redactErrors(check.errors);
    const unknown = errors.some((entry) => entry.keyword === "additionalProperties");
    const code = unknown ? VALIDATOR_ERRORS.unknownField : VALIDATOR_ERRORS.schema;
    return { ok: false, error: { code, message: `The ${name} payload does not satisfy its V3 schema.`, details: { schema: name, errors } } };
  }

  function assertValid(name, value) {
    const result = validate(name, value);
    if (!result.ok) throw new MemoryContractError(result.error.code, result.error.message, result.error.details);
    return result.value;
  }

  function has(name) { return compiled.has(String(name || "")); }
  function list() { return [...compiled.keys()]; }

  return Object.freeze({
    version: V3_SCHEMA_VERSION,
    schemas: source,
    validate,
    assertValid,
    validator: resolve,
    has,
    list,
  });
}

let defaultRegistry;
function getDefaultMemorySchemaRegistry() {
  if (!defaultRegistry) defaultRegistry = createMemorySchemaRegistry();
  return defaultRegistry;
}

module.exports = Object.freeze({
  VALIDATOR_ERRORS,
  createMemorySchemaRegistry,
  getDefaultMemorySchemaRegistry,
  redactErrors,
});
