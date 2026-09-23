"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const DELEGATE_OPERATIONS = Object.freeze([
  "spawn",
  "follow_up",
  "steer",
  "stop",
  "list",
  "inspect",
  "resolve_question",
]);

const DELEGATE_AGENT_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    operation: { type: "string", enum: DELEGATE_OPERATIONS },
    childInvocationId: { type: "string" },
    task: { type: "string" },
    contextPackage: {
      type: "object",
      required: ["role", "authority", "scope", "identity", "resources"],
      properties: {
        role: { type: "string" },
        authority: { type: "string" },
        scope: { type: "object" },
        identity: { type: "object" },
        resources: { type: "object" },
      },
    },
    expectedOutput: {
      type: "object",
      required: ["description", "format"],
      properties: {
        description: { type: "string" },
        format: { type: "string" },
      },
    },
    agents: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        required: ["task", "contextPackage", "expectedOutput"],
        properties: {
          task: { type: "string" },
          contextPackage: {
            type: "object",
            required: ["role", "authority", "scope", "identity", "resources"],
            properties: {
              role: { type: "string" },
              authority: { type: "string" },
              scope: { type: "object" },
              identity: { type: "object" },
              resources: { type: "object" },
            },
          },
          expectedOutput: {
            type: "object",
            required: ["description", "format"],
            properties: {
              description: { type: "string" },
              format: { type: "string" },
            },
          },
        },
      },
    },
    resolution: { type: "string", enum: ["answer", "skip", "escalate"] },
    answers: { type: "array" },
    questionRequestId: { type: "string" },
  },
});

const DELEGATE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_DELEGATE_AGENT_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  PROVIDER_UNAVAILABLE: "DELEGATE_AGENT_PROVIDER_UNAVAILABLE",
  DELEGATION_FAILED: "DELEGATE_AGENT_DELEGATION_FAILED",
  INVALID_CHILD_CONTEXT: "INVALID_DELEGATED_CHILD_CONTEXT",
  TOO_MANY_SUBAGENTS: "TOO_MANY_SUBAGENTS",
  SPAWN_WHILE_CHILDREN_ACTIVE: "SPAWN_WHILE_CHILDREN_ACTIVE",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeSpawnAgents(input) {
  if (Array.isArray(input?.agents) && input.agents.length) {
    if (input.agents.length > 5) {
      return invalidInput("agents may contain at most 5 entries", DELEGATE_ERROR_CODES.TOO_MANY_SUBAGENTS);
    }
    for (let index = 0; index < input.agents.length; index += 1) {
      const agent = input.agents[index];
      const instruction = validateInstructionFields(agent);
      if (!instruction.ok) {
        return { ok: false, error: { ...instruction.error, message: `agents[${index}]: ${instruction.error.message}` } };
      }
    }
    return { ok: true, agents: input.agents };
  }
  const instruction = validateInstructionFields(input);
  if (!instruction.ok) return instruction;
  return {
    ok: true,
    agents: [{
      task: input.task,
      contextPackage: input.contextPackage,
      expectedOutput: input.expectedOutput,
    }],
  };
}

function invalidInput(message, code = DELEGATE_ERROR_CODES.INVALID_INPUT) {
  return { ok: false, error: { code, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInstructionFields(input) {
  if (typeof input.task !== "string" || input.task.trim() === "") {
    return invalidInput("task must be a non-empty string");
  }
  if (!isRecord(input.contextPackage)) {
    return invalidInput("contextPackage must be an object");
  }
  const contextPackage = input.contextPackage;
  if (typeof contextPackage.role !== "string" || contextPackage.role.trim() === "") {
    return invalidInput("contextPackage.role must be a non-empty string");
  }
  if (typeof contextPackage.authority !== "string" || contextPackage.authority.trim() === "") {
    return invalidInput("contextPackage.authority must be a non-empty string");
  }
  for (const field of ["scope", "identity", "resources"]) {
    if (!isRecord(contextPackage[field])) {
      return invalidInput(`contextPackage.${field} must be an object`);
    }
  }
  if (!isRecord(input.expectedOutput)) {
    return invalidInput("expectedOutput must be an object");
  }
  if (typeof input.expectedOutput.description !== "string" || input.expectedOutput.description.trim() === "") {
    return invalidInput("expectedOutput.description must be a non-empty string");
  }
  if (typeof input.expectedOutput.format !== "string" || input.expectedOutput.format.trim() === "") {
    return invalidInput("expectedOutput.format must be a non-empty string");
  }
  return { ok: true };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  const operation = String(input.operation || "spawn").toLowerCase();
  if (!DELEGATE_OPERATIONS.includes(operation)) {
    return invalidInput(`operation must be one of: ${DELEGATE_OPERATIONS.join(", ")}`);
  }
  if (operation === "list") return { ok: true, operation };
  if (operation === "resolve_question") {
    const resolution = String(input.resolution || "").toLowerCase();
    if (!["answer", "skip", "escalate"].includes(resolution)) {
      return invalidInput("resolution must be answer, skip, or escalate for resolve_question");
    }
    if (resolution === "answer") {
      if (!Array.isArray(input.answers) || !input.answers.length) {
        return invalidInput("answers are required when resolution is answer");
      }
    }
    return { ok: true, operation };
  }
  if (["follow_up", "steer", "stop", "inspect"].includes(operation)) {
    if (typeof input.childInvocationId !== "string" || input.childInvocationId.trim() === "") {
      return invalidInput(`childInvocationId is required for ${operation}`);
    }
  }
  if (["spawn", "follow_up", "steer"].includes(operation)) {
    if (operation === "spawn") {
      const spawnAgents = normalizeSpawnAgents(input);
      if (!spawnAgents.ok) return spawnAgents;
      return { ok: true, operation, agents: spawnAgents.agents };
    }
    const instruction = validateInstructionFields(input);
    if (!instruction.ok) return instruction;
  }
  return { ok: true, operation };
}

function mapProviderError(outcome) {
  const code = String(outcome?.code || outcome?.error?.code || DELEGATE_ERROR_CODES.DELEGATION_FAILED);
  const message = String(outcome?.error || outcome?.message || outcome?.error?.message || "Delegation failed.");
  return structuredFailure(code, message, {
    childInvocationId: outcome?.childInvocationId,
    status: outcome?.status,
    metadata: isRecord(outcome?.metadata) ? outcome.metadata : {},
  });
}

function isAcceptanceOutcome(outcome) {
  if (outcome?.acceptance === true) return true;
  const status = String(outcome?.status || "").toLowerCase();
  return ["queued", "working"].includes(status);
}

// Default deterministic provider: echoes the bounded delegation without
// contacting any specialized agent. Real environments inject a provider that
// derives a bounded child context and runs the delegated agent.
function defaultDelegationProvider(input) {
  const operation = String(input.operation || "spawn").toLowerCase();
  if (operation === "list") {
    return { ok: true, acceptance: true, children: [], status: "completed", childInvocationId: "list", output: { text: "", format: "json", summary: "Roster listed." } };
  }
  return {
    ok: true,
    childInvocationId: `delegated-${input.task.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 32)}`,
    output: {
      text: `Simulated specialized agent for task: ${input.task}`,
      format: input.expectedOutput?.format || "text",
      summary: input.expectedOutput?.description || input.task,
    },
    status: "completed",
  };
}

function createDelegateAgentTool({ delegationProvider = null } = {}) {
  const configuredDelegate = typeof delegationProvider === "function" ? delegationProvider : null;

  const adapter = {
    name: "delegate_agent",
    description: [
      "Spawn and manage delegated child agents against the same workspace (children cannot call delegate_agent).",
      "Operations: spawn (new child), follow_up (terminal child only), steer (queued/working child — does not abort in-flight tools), stop, list, inspect, resolve_question (FIFO head: answer|skip|escalate; no childInvocationId).",
      "spawn/follow_up/steer require labeled instruction fields: task (objective), contextPackage (role, authority, scope, identity, resources), expectedOutput (description + exact return format).",
      "Spawn/steer/follow_up return immediate acceptance (child id + queued/working status), not the child's final output. Results arrive FIFO in the same user turn.",
      "One spawn call may start 1–5 children via task/contextPackage/expectedOutput or an agents array of those objects; after spawn the orchestrator waits until every child finishes before normal work resumes.",
      "While any spawned child is still queued or working, do not spawn again; use list/inspect/steer/stop/follow_up/resolve_question only.",
      "Use steer for running children; follow_up only after completed/stopped/failed. list/inspect expose pendingQuestion on each roster entry.",
    ].join(" "),
    inputSchema: DELEGATE_AGENT_INPUT_SCHEMA,
    async execute(input, executionContext, runtime = {}) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(DELEGATE_ERROR_CODES.INVALID_CONTEXT, "delegate_agent requires a restricted tool execution context projection");
      }

      let outcome;
      try {
        const runtimeDelegate = typeof runtime?.delegationProvider === "function" ? runtime.delegationProvider : null;
        const delegate = runtimeDelegate || configuredDelegate || defaultDelegationProvider;
        outcome = await delegate(input, executionContext, runtime);
      } catch (error) {
        const code = String(error?.code || DELEGATE_ERROR_CODES.DELEGATION_FAILED);
        return structuredFailure(code, error.message);
      }

      if (outcome?.ok === false) {
        return mapProviderError(outcome);
      }

      const operation = String(input.operation || "spawn").toLowerCase();
      if (operation === "list") {
        return {
          ok: true,
          value: {
            operation: "list",
            children: Array.isArray(outcome?.children) ? outcome.children : [],
            parentInvocationId: executionContext.invocationId,
            provider: (typeof runtime?.delegationProvider === "function" || configuredDelegate) ? "injected" : "default",
          },
        };
      }
      if (operation === "resolve_question") {
        return {
          ok: true,
          value: {
            operation: "resolve_question",
            questionRequestId: outcome.questionRequestId,
            childInvocationId: outcome.childInvocationId,
            resolution: outcome.resolution,
            parentInvocationId: executionContext.invocationId,
            provider: (typeof runtime?.delegationProvider === "function" || configuredDelegate) ? "injected" : "default",
          },
        };
      }

      if (typeof outcome?.childInvocationId !== "string" || outcome.childInvocationId.trim() === "") {
        return structuredFailure(DELEGATE_ERROR_CODES.DELEGATION_FAILED, "delegation provider returned an invalid outcome shape");
      }

      if (isAcceptanceOutcome(outcome)) {
        const output = isRecord(outcome.output) ? outcome.output : {
          text: "",
          format: String(input.expectedOutput?.format || input.agents?.[0]?.expectedOutput?.format || "text"),
          summary: String(outcome.summary || outcome.output?.summary || input.expectedOutput?.description || input.agents?.[0]?.expectedOutput?.description || "Accepted."),
        };
        const children = Array.isArray(outcome.children) ? outcome.children : null;
        return {
          ok: true,
          value: {
            childInvocationId: outcome.childInvocationId,
            childSessionId: outcome.childSessionId || outcome.metadata?.sessionId || "",
            operation,
            parentInvocationId: executionContext.invocationId,
            role: input.contextPackage?.role || input.agents?.[0]?.contextPackage?.role,
            authority: input.contextPackage?.authority || input.agents?.[0]?.contextPackage?.authority,
            provider: (typeof runtime?.delegationProvider === "function" || configuredDelegate) ? "injected" : "default",
            output,
            status: String(outcome.status || "queued").toLowerCase(),
            acceptance: true,
            steerQueueLength: outcome.steerQueueLength,
            metadata: isRecord(outcome.metadata) ? outcome.metadata : {},
            ...(children ? { children } : {}),
          },
        };
      }

      if (!isRecord(outcome.output)) {
        return structuredFailure(DELEGATE_ERROR_CODES.DELEGATION_FAILED, "delegation provider returned no structured child output");
      }
      const outcomeStatus = String(outcome.status || "completed").toLowerCase();
      if (["failed", "stopped"].includes(outcomeStatus)) {
        return structuredFailure(
          DELEGATE_ERROR_CODES.DELEGATION_FAILED,
          String(outcome.metadata?.error || outcome.output?.text || `Delegated child ${outcomeStatus}.`),
          {
            childInvocationId: outcome.childInvocationId,
            status: outcomeStatus,
            metadata: isRecord(outcome.metadata) ? outcome.metadata : {},
          },
        );
      }

      return {
        ok: true,
        value: {
          childInvocationId: outcome.childInvocationId,
          operation,
          parentInvocationId: executionContext.invocationId,
          role: input.contextPackage?.role,
          authority: input.contextPackage?.authority,
          provider: (typeof runtime?.delegationProvider === "function" || configuredDelegate) ? "injected" : "default",
          output: {
            text: String(outcome.output.text || ""),
            format: String(outcome.output.format || input.expectedOutput?.format || "text"),
            summary: String(outcome.output.summary || input.expectedOutput?.description || ""),
          },
          status: outcomeStatus,
          metadata: isRecord(outcome.metadata) ? outcome.metadata : {},
        },
      };
    },
  };

  return adapter;
}

module.exports = {
  DELEGATE_AGENT_INPUT_SCHEMA,
  DELEGATE_ERROR_CODES,
  DELEGATE_OPERATIONS,
  createDelegateAgentTool,
  defaultDelegationProvider,
  validateInput,
};
