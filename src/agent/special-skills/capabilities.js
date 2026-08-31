"use strict";

// Creation skills expose one narrowly scoped writer without expanding the
// canonical tool registry. Other internal skills use the shared runtime tools
// and memory services directly.
const CREATE_GUIDANCE_TOOL = "create_guidance";

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
  return definitions;
}

function createSpecialSkillToolEntry(skill, requestedCapability = "") {
  const capability = String(requestedCapability || "").trim();
  const isGuidance = capability === CREATE_GUIDANCE_TOOL && specialSkillNeeds(skill, CREATE_GUIDANCE_TOOL);
  if (!isGuidance) return null;
  return {
    name: CREATE_GUIDANCE_TOOL,
    description: "Create a validated user guidance file in the project or global guidance store.",
    inputSchema: CREATE_GUIDANCE_INPUT_SCHEMA,
    // The adapter marker lets the authority environment gate treat this as a
    // local capability.  Execution is intentionally performed by the main
    // process branch below, not by arbitrary model-provided code.
    adapter: { inputSchema: CREATE_GUIDANCE_INPUT_SCHEMA },
    metadata: {
      mutating: true,
      reversible: false,
      targetTypes: ["file", "workspace"],
    },
    specialSkill: String((skill?.manifest || skill)?.id || ""),
  };
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
  createSpecialSkillToolDefinitions,
  createSpecialSkillToolEntry,
  executeCreateGuidance,
  requiredCapabilities,
  specialSkillNeeds,
});
