"use strict";

const { assertGateAdapter, decision } = require("../../../contracts/tool/gate-adapter.js");
const { collectTargets } = require("./target-normalizer.js");

function gate(name, evaluate) {
  return assertGateAdapter({ name, async evaluate(input = {}) { return evaluate(input); } });
}

function allow(name, reason = "Allowed", metadata = {}) {
  return decision(name, { decision: "allow", terminal: false, reason, metadata });
}

function deny(name, reason, metadata = {}, policyReference = "") {
  return decision(name, { decision: "deny", terminal: true, reason, metadata, policyReference });
}

function restrict(name, reason, restrictions = [], metadata = {}, terminal = true) {
  return decision(name, { decision: "restrict", terminal, reason, restrictions, metadata });
}

function validateValue(value, schema, path = "input") {
  if (!schema || typeof schema !== "object") return [];
  const errors = [];
  const validType = (expected) => (expected === "object" && value !== null && typeof value === "object" && !Array.isArray(value))
    || (expected === "array" && Array.isArray(value))
    || (expected === "string" && typeof value === "string")
    || (expected === "number" && typeof value === "number" && Number.isFinite(value))
    || (expected === "integer" && Number.isInteger(value))
    || (expected === "boolean" && typeof value === "boolean")
    || (expected === "null" && value === null);
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some(validType)) return [`${path} must be ${types.join(" or ")}`];
  if (Array.isArray(schema.allOf)) for (const branch of schema.allOf) errors.push(...validateValue(value, branch, path));
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => validateValue(value, branch, path).length === 0)) errors.push(`${path} does not satisfy any allowed input form`);
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter((branch) => validateValue(value, branch, path).length === 0).length !== 1) errors.push(`${path} must satisfy exactly one allowed input form`);
  if (schema.not && validateValue(value, schema.not, path).length === 0) errors.push(`${path} matches a forbidden input form`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} is not an allowed value`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is too long`);
    if (schema.pattern) {
      try { if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} does not match the required pattern`); }
      catch { errors.push(`${path} has an invalid schema pattern`); }
    }
    if (schema.format === "uri") { try { new URL(value); } catch { errors.push(`${path} must be a valid URI`); } }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} is above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} has too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} has too many items`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${path} must contain unique items`);
    if (schema.items) value.forEach((item, index) => errors.push(...validateValue(item, schema.items, `${path}[${index}]`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} is required`);
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) errors.push(...validateValue(value[key], child, `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not supported`);
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      const declared = new Set(Object.keys(schema.properties || {}));
      for (const [key, child] of Object.entries(value)) if (!declared.has(key)) errors.push(...validateValue(child, schema.additionalProperties, `${path}.${key}`));
    }
  }
  return errors;
}

function targetValues(args = {}, metadata = {}, workspaceRoot = "") {
  return collectTargets(args, metadata, workspaceRoot);
}

module.exports = { allow, deny, gate, restrict, targetValues, validateValue };
