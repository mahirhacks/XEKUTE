"use strict";

const FINDING_VERDICTS = Object.freeze([
  "accept",
  "reject",
  "inconclusive",
  "partial",
]);

const VERIFY_FINDING_ERROR_CODES = Object.freeze({
  INVALID_RESULT: "INVALID_VERIFY_FINDING_RESULT",
  INVALID_VERDICT: "INVALID_FINDING_VERDICT",
  INVALID_FIELD: "INVALID_VERIFY_FINDING_FIELD",
});

const FINDING_VERDICT_SET = new Set(FINDING_VERDICTS);

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateVerifyFindingResult(result) {
  if (!isRecord(result)) {
    return failure(VERIFY_FINDING_ERROR_CODES.INVALID_RESULT, "Verify-finding result must be an object");
  }
  if (typeof result.findingId !== "string" || result.findingId.trim() === "") {
    return failure(VERIFY_FINDING_ERROR_CODES.INVALID_FIELD, "findingId must be a non-empty string");
  }
  if (!FINDING_VERDICT_SET.has(result.verdict)) {
    return failure(VERIFY_FINDING_ERROR_CODES.INVALID_VERDICT, "Finding verdict is unsupported");
  }
  if (typeof result.reason !== "string" || result.reason.trim() === "") {
    return failure(VERIFY_FINDING_ERROR_CODES.INVALID_FIELD, "reason must be a non-empty string");
  }
  if (result.evidenceRefs !== undefined && (!Array.isArray(result.evidenceRefs) || result.evidenceRefs.some(ref => typeof ref !== "string"))) {
    return failure(VERIFY_FINDING_ERROR_CODES.INVALID_FIELD, "evidenceRefs must be an array of strings when provided");
  }
  if (result.procedureReference !== undefined && (typeof result.procedureReference !== "string" || result.procedureReference.trim() === "")) {
    return failure(VERIFY_FINDING_ERROR_CODES.INVALID_FIELD, "procedureReference must be a non-empty string when provided");
  }
  if (result.capabilityData !== undefined && !isRecord(result.capabilityData)) {
    return failure(VERIFY_FINDING_ERROR_CODES.INVALID_FIELD, "capabilityData must be an object when provided");
  }
  if (result.metadata !== undefined && !isRecord(result.metadata)) {
    return failure(VERIFY_FINDING_ERROR_CODES.INVALID_FIELD, "metadata must be an object when provided");
  }
  if (result.verification !== undefined) {
    return failure(
      VERIFY_FINDING_ERROR_CODES.INVALID_FIELD,
      "Lifecycle verification fields belong on tool results, not verify-finding results",
    );
  }
  return { ok: true, value: result };
}

function createVerifyFindingResult(input = {}) {
  const allowed = new Set([
    "findingId",
    "verdict",
    "reason",
    "evidenceRefs",
    "procedureReference",
    "capabilityData",
    "metadata",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`Unknown verify-finding result field: ${key}`);
  }

  const {
    findingId,
    verdict,
    reason,
    evidenceRefs = [],
    procedureReference,
    capabilityData,
    metadata = {},
  } = input;
  const result = {
    findingId,
    verdict,
    reason,
    evidenceRefs,
    procedureReference,
    capabilityData,
    metadata,
  };
  const validated = validateVerifyFindingResult(result);
  if (!validated.ok) throw new TypeError(validated.error.message);
  return result;
}

module.exports = {
  FINDING_VERDICTS,
  VERIFY_FINDING_ERROR_CODES,
  createVerifyFindingResult,
  validateVerifyFindingResult,
};
