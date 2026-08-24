"use strict";

// Special skills may expose narrowly scoped runtime capabilities without
// expanding the canonical tool registry.  This keeps the shipped tool
// inventory stable while allowing a skill package to bring the one capability
// it needs along with it.
const CREATE_GUIDANCE_TOOL = "create_guidance";
const MANAGE_PENTEST_TOOL = "manage_pentest";

const CREATE_GUIDANCE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["rule", "skill", "subagent"],
      description: "The user-guidance kind to create.",
    },
    scope: {
      type: "string",
      enum: ["project", "global"],
      description: "Store in the current project or the user's global guidance root.",
    },
    name: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description: "A single guidance filename or name; path separators are not allowed.",
    },
    content: {
      type: "string",
      minLength: 1,
      maxLength: 100 * 1024,
      description: "The complete Markdown/text guidance body.",
    },
    overwrite: {
      type: "boolean",
      description: "Only set true when the user explicitly asks to replace an existing file.",
    },
  },
  required: ["kind", "name", "content"],
});

const MANAGE_PENTEST_INPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    operation: {
      type: "string",
      enum: ["status", "refresh", "update_task", "complete_iteration", "stop"],
      description: "Inspect or advance the active adaptive pentest run.",
    },
    taskId: { type: "string", maxLength: 200, description: "Checklist task ID for update_task." },
    status: {
      type: "string",
      enum: ["ready", "running", "completed", "verified", "rejected", "inconclusive", "blocked", "not-tested", "retest-required"],
    },
    result: { type: "string", maxLength: 8_000 },
    evidenceIds: { type: "array", maxItems: 100, items: { type: "string", maxLength: 300 } },
    discoveredFacts: { type: "array", maxItems: 100, items: { type: "string", maxLength: 2_000 } },
    reason: { type: "string", maxLength: 1_000 },
  },
  required: ["operation"],
});

function requiredCapabilities(skill) {
  const manifest = skill?.manifest || skill || {};
  return new Set([
    ...(Array.isArray(manifest.requiredTools) ? manifest.requiredTools : []),
    ...(Array.isArray(manifest.requiredCapabilities) ? manifest.requiredCapabilities : []),
  ].map((value) => String(value || "").trim()).filter(Boolean));
}

function specialSkillNeeds(skill, capability) {
  return requiredCapabilities(skill).has(String(capability || "").trim());
}

function createSpecialSkillToolDefinitions(skill) {
  const manifest = skill?.manifest || skill || {};
  const definitions = [];
  if (specialSkillNeeds(skill, CREATE_GUIDANCE_TOOL)) definitions.push({
      type: "function",
      function: {
        name: CREATE_GUIDANCE_TOOL,
        description: "Create a validated user guidance file in the project or global guidance store.",
        parameters: CREATE_GUIDANCE_INPUT_SCHEMA,
      },
      specialSkill: manifest.id || "",
    });
  if (specialSkillNeeds(skill, MANAGE_PENTEST_TOOL)) definitions.push({
    type: "function",
    function: {
      name: MANAGE_PENTEST_TOOL,
      description: "Inspect, synchronize, update, iterate, or stop the active adaptive pentest run. Canonical intelligence is resynchronized automatically.",
      parameters: MANAGE_PENTEST_INPUT_SCHEMA,
    },
    specialSkill: manifest.id || "",
  });
  return definitions;
}

function createSpecialSkillToolEntry(skill, requestedCapability = "") {
  const capability = String(requestedCapability || "").trim();
  const isGuidance = capability === CREATE_GUIDANCE_TOOL && specialSkillNeeds(skill, CREATE_GUIDANCE_TOOL);
  const isPentest = capability === MANAGE_PENTEST_TOOL && specialSkillNeeds(skill, MANAGE_PENTEST_TOOL);
  if (!isGuidance && !isPentest) return null;
  const name = isGuidance ? CREATE_GUIDANCE_TOOL : MANAGE_PENTEST_TOOL;
  return {
    name,
    description: isGuidance ? "Create a validated user guidance file in the project or global guidance store." : "Manage the active adaptive pentest run and its derived planning artifacts.",
    inputSchema: isGuidance ? CREATE_GUIDANCE_INPUT_SCHEMA : MANAGE_PENTEST_INPUT_SCHEMA,
    // The adapter marker lets the authority environment gate treat this as a
    // local capability.  Execution is intentionally performed by the main
    // process branch below, not by arbitrary model-provided code.
    adapter: { inputSchema: CREATE_GUIDANCE_INPUT_SCHEMA },
    metadata: {
      mutating: true,
      reversible: isPentest,
      targetTypes: isGuidance ? ["file", "workspace"] : ["assessment", "workspace"],
    },
    specialSkill: String((skill?.manifest || skill)?.id || ""),
  };
}

async function executeManagePentest({ args = {}, workspace = "", runId = "", orchestrator = null } = {}) {
  if (!orchestrator?.execute) return { ok: false, error: "The pentest orchestration service is unavailable.", code: "PENTEST_ORCHESTRATOR_UNAVAILABLE", retryable: false };
  const result = await orchestrator.execute({ workspace, runId, args });
  if (!result?.ok) return { ok: false, error: result?.error || "The pentest operation failed.", code: result?.code || "PENTEST_OPERATION_FAILED", retryable: false, details: result };
  return { ok: true, value: result };
}

function executeCreateGuidance({ args = {}, workspace = "", globalRoot = "", writeGuidanceFile } = {}) {
  if (typeof writeGuidanceFile !== "function") {
    return { ok: false, error: "The guidance storage service is unavailable.", code: "GUIDANCE_SERVICE_UNAVAILABLE", retryable: false };
  }
  const result = writeGuidanceFile({
    workspace,
    globalRoot,
    scope: args.scope || "project",
    kind: args.kind,
    name: args.name,
    content: args.content,
    overwrite: Boolean(args.overwrite),
  });
  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error || "The guidance file could not be created.",
      code: result?.code || "GUIDANCE_WRITE_FAILED",
      retryable: false,
    };
  }
  const value = {
    mode: "create_guidance",
    kind: result.kind,
    scope: result.scope,
    file: result.file,
    guidancePath: result.relativePath,
    path: result.absolute,
    summary: `Created ${result.kind} guidance ${result.relativePath}`,
  };
  return { ok: true, ...value, value };
}

module.exports = Object.freeze({
  CREATE_GUIDANCE_INPUT_SCHEMA,
  CREATE_GUIDANCE_TOOL,
  MANAGE_PENTEST_INPUT_SCHEMA,
  MANAGE_PENTEST_TOOL,
  createSpecialSkillToolDefinitions,
  createSpecialSkillToolEntry,
  executeCreateGuidance,
  executeManagePentest,
  requiredCapabilities,
  specialSkillNeeds,
});
