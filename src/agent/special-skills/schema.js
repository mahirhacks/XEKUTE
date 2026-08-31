"use strict";

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_MODES = Object.freeze(["agent", "ask", "plan", "hypothesis"]);
const SUPPORTED_MODES = new Set(DEFAULT_MODES);

function string(value, fallback = "", max = 240) {
  const text = String(value == null ? "" : value).replace(/\u0000/g, "").trim();
  return (text || fallback).slice(0, max);
}

function list(value, fallback = DEFAULT_MODES, max = 20) {
  const values = Array.isArray(value) ? value : value == null || value === "" ? fallback : [value];
  return [...new Set(values.map((item) => string(item, "", 80)).filter(Boolean))].slice(0, max);
}

function normalizeManifest(metadata = {}, { id = "", source = "", resources = [] } = {}) {
  const normalizedId = string(metadata.id || id, "", 120).toLowerCase();
  const acceptsContext = metadata.accepts_context === undefined && metadata.acceptsContext === undefined && metadata.accepts_trailing_prose === undefined
    ? true
    : Boolean(metadata.accepts_context ?? metadata.acceptsContext ?? metadata.accepts_trailing_prose);
  const requiredCapabilities = list(metadata.required_runtime_capabilities || metadata.requiredCapabilities || metadata.requiredTools, [], 40);
  const normalized = {
    id: normalizedId,
    title: string(metadata.title || normalizedId.replace(/-/g, " "), "", 240),
    description: string(metadata.description || metadata.summary, "", 800),
    version: string(metadata.version, "1.0.0", 40),
    entrypoint: string(metadata.entrypoint, "SKILL.md", 120),
    resources: list(metadata.resources, resources, 32),
    modes: list(metadata.modes || metadata.supported_modes || metadata.supportedModes, DEFAULT_MODES, 12),
    requiredTools: list(metadata.required_tools || metadata.requiredTools, requiredCapabilities, 40),
    requiredCapabilities,
    parameterPolicy: string(metadata.parameter_policy || metadata.parameterPolicy, "context-only", 40).toLowerCase(),
    visibility: string(metadata.visibility, "internal", 40).toLowerCase(),
    instructionRole: string(metadata.instruction_role || metadata.instructionRole, "skill-context", 40).toLowerCase(),
    acceptsContext,
    acceptsTrailingProse: acceptsContext,
    source: string(source, "", 500),
  };
  return Object.freeze(normalized);
}

function validateManifest(manifest) {
  const errors = [];
  if (!manifest || !ID_RE.test(manifest.id)) errors.push("id must contain lowercase letters, numbers, and hyphens");
  if (!manifest?.title) errors.push("title is required");
  if (!manifest?.description) errors.push("description is required");
  if (!manifest?.version) errors.push("version is required");
  if (!manifest?.entrypoint || manifest.entrypoint.includes("..") || manifest.entrypoint.includes("\\")) errors.push("entrypoint must be a package-relative file");
  if (!Array.isArray(manifest?.modes) || !manifest.modes.length) errors.push("at least one mode is required");
  if (Array.isArray(manifest?.modes) && manifest.modes.some((mode) => !SUPPORTED_MODES.has(mode))) errors.push("modes must be selected from agent, ask, plan, or hypothesis");
  if (typeof manifest?.acceptsContext !== "boolean") errors.push("accepts_context must be boolean");
  if (manifest?.parameterPolicy !== "context-only") errors.push("parameter_policy must be context-only");
  if (manifest?.visibility !== "internal") errors.push("visibility must be internal");
  if (manifest?.instructionRole !== "skill-context") errors.push("instruction_role must be skill-context");
  return errors;
}

module.exports = Object.freeze({ DEFAULT_MODES, ID_RE, SUPPORTED_MODES, normalizeManifest, validateManifest });
