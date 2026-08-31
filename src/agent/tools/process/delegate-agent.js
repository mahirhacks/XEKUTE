"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const DELEGATE_AGENT_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["task", "contextPackage", "expectedOutput"],
  properties: {
    operation: { type: "string", enum: ["spawn", "follow_up"] },
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
  },
});

const DELEGATE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_DELEGATE_AGENT_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  PROVIDER_UNAVAILABLE: "DELEGATE_AGENT_PROVIDER_UNAVAILABLE",
  DELEGATION_FAILED: "DELEGATE_AGENT_DELEGATION_FAILED",
  INVALID_CHILD_CONTEXT: "INVALID_DELEGATED_CHILD_CONTEXT",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: DELEGATE_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
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
  const operation = String(input.operation || "spawn").toLowerCase();
  if (!["spawn", "follow_up"].includes(operation)) return invalidInput("operation must be spawn or follow_up");
  if (operation === "follow_up" && (typeof input.childInvocationId !== "string" || input.childInvocationId.trim() === "")) {
    return invalidInput("childInvocationId is required for a follow_up");
  }
  return { ok: true };
}

// Default deterministic provider: echoes the bounded delegation without
// contacting any specialized agent. Real environments inject a provider that
// derives a bounded child context and runs the delegated agent.
function defaultDelegationProvider(input) {
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
      "Spawn a real child agent that runs the parent's tool set (except further delegation) against the same workspace.",
      "Use operation=spawn for a new child, or operation=follow_up with childInvocationId to resume a finished child with feedback.",
      "Put everything the child needs in task and contextPackage; the child does NOT see the parent's chat transcript.",
      "task: the exact, self-contained instruction the child must execute. contextPackage: role/authority/scope/identity/resources the child inherits.",
      "expectedOutput: what the child must return (description + format).",
      "The parent receives immediate acceptance, then one FIFO result after the child completes; use read_file/search_workspace afterwards to verify any claimed file changes.",
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
        return structuredFailure(DELEGATE_ERROR_CODES.DELEGATION_FAILED, error.message);
      }

      if (!isRecord(outcome) || typeof outcome.childInvocationId !== "string" || outcome.childInvocationId.trim() === "") {
        return structuredFailure(DELEGATE_ERROR_CODES.DELEGATION_FAILED, "delegation provider returned an invalid outcome shape");
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
          operation: String(input.operation || "spawn").toLowerCase(),
          parentInvocationId: executionContext.invocationId,
          role: input.contextPackage.role,
          authority: input.contextPackage.authority,
          provider: (typeof runtime?.delegationProvider === "function" || configuredDelegate) ? "injected" : "default",
          output: {
            text: String(outcome.output.text || ""),
            format: String(outcome.output.format || input.expectedOutput.format || "text"),
            summary: String(outcome.output.summary || input.expectedOutput.description || ""),
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
  createDelegateAgentTool,
  defaultDelegationProvider,
  validateInput,
};
