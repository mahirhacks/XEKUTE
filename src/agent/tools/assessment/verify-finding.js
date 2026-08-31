"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");
const { createVerifyFindingResult } = require("../../../contracts/tool/verify-finding-result");

const VERIFY_FINDING_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["findingId", "procedure", "evidence"],
  properties: {
    findingId: { type: "string" },
    procedure: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        required: ["ref", "kind"],
        properties: {
          ref: { type: "string" },
          kind: { type: "string" },
          content: { type: "string" },
          metadata: { type: "object" },
        },
      },
      minItems: 1,
    },
    procedureReference: { type: "string" },
  },
});

const VERIFY_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_VERIFY_FINDING_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  PROCEDURE_FAILED: "VERIFY_FINDING_PROCEDURE_FAILED",
  INSUFFICIENT_EVIDENCE: "VERIFY_FINDING_INSUFFICIENT_EVIDENCE",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: VERIFY_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (typeof input.findingId !== "string" || input.findingId.trim() === "") {
    return invalidInput("findingId must be a non-empty string");
  }
  if (typeof input.procedure !== "string" || input.procedure.trim() === "") {
    return invalidInput("procedure must be a non-empty string");
  }
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
    return invalidInput("evidence must be a non-empty array");
  }
  for (let i = 0; i < input.evidence.length; i += 1) {
    const e = input.evidence[i];
    if (!isRecord(e) || typeof e.ref !== "string" || e.ref.trim() === "" || typeof e.kind !== "string" || e.kind.trim() === "") {
      return invalidInput(`evidence[${i}] must have non-empty ref and kind`);
    }
    if (e.metadata !== undefined && !isRecord(e.metadata)) return invalidInput(`evidence[${i}].metadata must be an object`);
  }
  if (input.procedureReference !== undefined && (typeof input.procedureReference !== "string" || input.procedureReference.trim() === "")) {
    return invalidInput("procedureReference must be a non-empty string");
  }
  return { ok: true };
}

// Default deterministic procedure: evidence-integrity check.
// Verdict is based on the evidence entries, never on authority/lifecycle state.
function defaultProcedure(input) {
  const evidence = input.evidence;
  const evidenceRefs = evidence.map(e => e.ref);
  const kinds = new Set(evidence.map(e => e.kind));

  // Insufficient evidence: no content or no refs.
  if (evidence.length === 0 || evidence.some(e => e.content === undefined || e.content === null || e.content === "")) {
    return {
      verdict: "inconclusive",
      reason: "Insufficient evidence: every evidence entry must include content",
      evidenceRefs,
      procedureReference: input.procedureReference || input.procedure,
      capabilityData: { checked: evidence.length },
    };
  }

  // A "request-response" or "traffic" kind with a 5xx/4xx status is a
  // rejection indicator; otherwise evidence with content is accepted.
  const rejected = evidence.some(e => {
    const status = e.metadata?.status;
    return (e.kind === "request-response" || e.kind === "traffic") && Number.isInteger(status) && status >= 400;
  });

  if (rejected) {
    return {
      verdict: "reject",
      reason: "Evidence contains an error-status response that contradicts the finding",
      evidenceRefs,
      procedureReference: input.procedureReference || input.procedure,
      capabilityData: { kinds: [...kinds], status: "error-response" },
    };
  }

  return {
    verdict: "accept",
    reason: "Evidence is consistent and supports the finding",
    evidenceRefs,
    procedureReference: input.procedureReference || input.procedure,
    capabilityData: { kinds: [...kinds] },
  };
}

function createVerifyFindingTool({ procedureRunner = null, v3Adapter = null } = {}) {
  const runProcedure = typeof procedureRunner === "function" ? procedureRunner : defaultProcedure;

  const adapter = {
    name: "verify_finding",
    inputSchema: VERIFY_FINDING_INPUT_SCHEMA,
    async execute(input, executionContext) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(VERIFY_ERROR_CODES.INVALID_CONTEXT, "verify_finding requires a restricted tool execution context projection");
      }

      // V3 keeps the canonical tool name and invocation pipeline, but routes
      // verified proof through the append-only Tier 2 Evidence gate.  The
      // legacy adapter remains available for isolated non-V3 callers/tests;
      // it is never selected for a V3-backed execution context.
      const memoryContext = executionContext.memoryContext || executionContext.requestMetadata;
      if (memoryContext?.version === 3 || memoryContext?.memoryVersion === 3) {
        const adapter = typeof v3Adapter === "function" ? v3Adapter() : v3Adapter;
        if (typeof adapter !== "function") return structuredFailure(VERIFY_ERROR_CODES.PROCEDURE_FAILED, "V3 Evidence verification service is unavailable");
        try {
          return await adapter(input, executionContext);
        } catch (error) {
          return structuredFailure(VERIFY_ERROR_CODES.PROCEDURE_FAILED, `V3 Evidence verification failed: ${error.message}`);
        }
      }

      let outcome;
      try {
        outcome = await runProcedure(input);
      } catch (error) {
        return structuredFailure(VERIFY_ERROR_CODES.PROCEDURE_FAILED, error.message);
      }

      if (!isRecord(outcome) || typeof outcome.verdict !== "string" || typeof outcome.reason !== "string") {
        return structuredFailure(VERIFY_ERROR_CODES.PROCEDURE_FAILED, "procedure returned an invalid outcome shape");
      }

      let result;
      try {
        result = createVerifyFindingResult({
          findingId: input.findingId,
          verdict: outcome.verdict,
          reason: outcome.reason,
          evidenceRefs: outcome.evidenceRefs || input.evidence.map(e => e.ref),
          procedureReference: outcome.procedureReference || input.procedureReference || input.procedure,
          capabilityData: outcome.capabilityData || {},
          metadata: outcome.metadata || {},
        });
      } catch (error) {
        return structuredFailure(VERIFY_ERROR_CODES.PROCEDURE_FAILED, error.message);
      }

      return { ok: true, value: result };
    },
  };

  return adapter;
}

module.exports = {
  VERIFY_FINDING_INPUT_SCHEMA,
  VERIFY_ERROR_CODES,
  createVerifyFindingTool,
  validateInput,
};
